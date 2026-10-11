// CONTROLLER layer for data sources: HTTP in/out only.
import type { NextFunction, Request, Response } from 'express';
import { removeUploadedFile } from '../../middleware/upload-file.js';
import { validate } from '../../lib/validate.js';
import {
  createDataSourceSchema,
  listRecordsSchema,
  previewSchema,
  startImportSchema,
} from './data-sources.schemas.js';
import * as dataSourcesService from './data-sources.service.js';
import { openCsvDownload } from './download/csv-download.js';

// POST /api/organizations/:slug/data-sources/preview   multipart: file, kind? (default "csv")
// → 200 { preview: { columns, sampleRows, idCandidates, problems, ... } }   Nothing is saved.
export async function preview(req: Request, res: Response) {
  try {
    const { kind } = validate(previewSchema, req.body ?? {});
    const result = await dataSourcesService.previewSource(kind, req.file);
    res.json({ preview: result });
  } finally {
    // The preview never keeps the file, whatever happened (success or error).
    await removeUploadedFile(req.file);
  }
}

// If the request fails BEFORE the import job took the file, delete it here.
// (After a successful 202 the job owns the file and deletes it when finished.)
async function withUploadCleanup(req: Request, work: () => Promise<void>) {
  try {
    await work();
  } catch (err) {
    await removeUploadedFile(req.file);
    throw err;
  }
}

// POST /api/organizations/:slug/data-sources   multipart: file, idColumn, name?, kind?
// → 202 { dataSource, import }   (the import runs in the background; poll the import)
export async function create(req: Request, res: Response) {
  await withUploadCleanup(req, async () => {
    const input = validate(createDataSourceSchema, req.body ?? {});
    const result = await dataSourcesService.createDataSource(req.organization!.id, input, req.file);
    res.status(202).json(result);
  });
}

// POST /api/organizations/:slug/data-sources/:dataSourceId/imports   multipart: file, mode?
// → 202 { import }   ·   409 IMPORT_IN_PROGRESS if one is already running
export async function startImport(req: Request, res: Response) {
  await withUploadCleanup(req, async () => {
    const input = validate(startImportSchema, req.body ?? {});
    const result = await dataSourcesService.startImport(req.dataSource!, input, req.file);
    res.status(202).json(result);
  });
}

// GET /api/organizations/:slug/data-sources/:dataSourceId/imports/:importId → 200 { import }
export async function getImport(req: Request, res: Response, _next: NextFunction) {
  res.set('Cache-Control', 'no-store'); // progress changes every second
  res.json(await dataSourcesService.getImport(req.dataSource!.id, String(req.params.importId)));
}

// ─────────────────────────────── task 2.4 ───────────────────────────────
// Reads answer with Cache-Control: no-store: row counts and import status change all the time,
// and the browser must never show an old copy.

// GET /api/organizations/:slug/data-sources → 200 { dataSources: [... + usedBy, latestImport] }
export async function list(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await dataSourcesService.listDataSources(req.organization!.id));
}

// GET /api/organizations/:slug/data-sources/:dataSourceId → 200 { dataSource }
export async function getOne(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await dataSourcesService.getDataSource(req.dataSource!.id));
}

// GET /api/organizations/:slug/data-sources/:dataSourceId/imports → 200 { imports } (newest 20)
export async function listImports(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await dataSourcesService.listImports(req.dataSource!.id));
}

// GET /api/organizations/:slug/data-sources/:dataSourceId/records?limit&afterPosition|search&afterId
// → 200 { columns, idColumn, total, records: [{ position, id, values }], next }
export async function listRecords(req: Request, res: Response) {
  const query = validate(listRecordsSchema, req.query);
  res.set('Cache-Control', 'no-store');
  res.json(await dataSourcesService.listRecords(req.dataSource!.id, query));
}

// GET /api/organizations/:slug/data-sources/:dataSourceId/download → 200 text/csv (streamed)
// Errors found before the first byte (404, 409 NO_DATA_YET, 429 busy) are normal JSON errors.
export async function download(req: Request, res: Response) {
  const csv = await openCsvDownload(req.organization!.id, req.dataSource!.id);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': attachmentHeader(csv.fileName),
    'Cache-Control': 'no-store',
  });
  try {
    await csv.pipeTo(res);
  } catch (err) {
    // The CSV had already started, so a JSON error can't be sent any more: the connection is
    // closed and the browser shows the download as failed. Just record why.
    if ((err as { code?: string }).code === 'ERR_STREAM_PREMATURE_CLOSE') {
      req.log.info('Download cancelled by the client');
    } else {
      req.log.error({ err }, 'Download failed while streaming');
    }
  }
}

// Content-Disposition with a safe ASCII name for old clients + the exact UTF-8 name (RFC 6266),
// e.g. "Größen.csv" → filename="Gr__en.csv"; filename*=UTF-8''Gr%C3%B6%C3%9Fen.csv
function attachmentHeader(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// DELETE /api/organizations/:slug/data-sources/:dataSourceId → 204
// 409 DATA_SOURCE_IN_USE (an API uses it) · 409 IMPORT_IN_PROGRESS
export async function remove(req: Request, res: Response) {
  await dataSourcesService.deleteDataSource(req.dataSource!);
  res.status(204).end();
}
