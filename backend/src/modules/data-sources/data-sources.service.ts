// SERVICE layer for data sources: business rules + database. No req/res here.
import path from 'node:path';
import { env } from '../../config/env.js';
import { Prisma, type DataImport, type DataSource } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../lib/prisma-errors.js';
import { SourceError, type SourceConnector, type SourceInput } from './connectors/connector.js';
import { getConnector } from './connectors/index.js';
import {
  IdCandidateFinder,
  MAX_PROBLEMS,
  checkHeader,
  isEmptyRow,
  normalizeCell,
  rowWidthProblem,
  type Problem,
} from './source-rules.js';
import type {
  CreateDataSourceInput,
  ListRecordsInput,
  StartImportInput,
} from './data-sources.schemas.js';
import { apisMissingColumns, describeMissing } from '../apis/design/column-guard.js';
import { findIdColumn } from './import/import-engine.js';
import { enqueueImport } from './import/import-runner.js';

// A preview reads only the START of the data, so it's instant even for a 500 000-row file.
// The full checks (every id present and unique, every row) run during the import (task 2.3).
const PREVIEW_SCAN_ROWS = 1000; // rows used to suggest id columns and spot problems
const PREVIEW_SAMPLE_ROWS = 10; // rows sent back to show in the table

// A data problem the user can fix → 400 SOURCE_INVALID (or 415 UNSUPPORTED_FILE).
function sourceErrorToAppError(err: SourceError): AppError {
  return new AppError(err.code === 'UNSUPPORTED_FILE' ? 415 : 400, err.code, err.message, {
    details: [{ field: err.rowNumber ? `row ${err.rowNumber}` : 'file', message: err.message }],
    cause: err,
  });
}

// File-based sources need a file with the right extension.
function checkUploadedFile(connector: SourceConnector, file: Express.Multer.File | undefined) {
  if (!connector.usesFile) return undefined;
  if (!file) {
    throw new AppError(400, 'FILE_REQUIRED', 'Choose a file to upload', {
      details: [{ field: 'file', message: 'Send the file in a multipart field named "file"' }],
    });
  }
  const extension = path.extname(file.originalname).toLowerCase();
  if (!connector.fileExtensions.includes(extension)) {
    throw new AppError(
      415,
      'UNSUPPORTED_FILE',
      `Upload a ${connector.fileExtensions.join(' or ')} file (got "${file.originalname}")`,
    );
  }
  return file;
}

async function openSource(connector: SourceConnector, input: SourceInput) {
  try {
    return await connector.open(input);
  } catch (err) {
    if (err instanceof SourceError) throw sourceErrorToAppError(err);
    throw err;
  }
}

// POST /data-sources/preview: what's in this file? (nothing is saved)
export async function previewSource(kind: string, file: Express.Multer.File | undefined) {
  const connector = getConnector(kind);
  const uploaded = checkUploadedFile(connector, file);
  const opened = await openSource(connector, {
    filePath: uploaded?.path,
    fileName: uploaded?.originalname,
    config: {},
  });

  try {
    const columns = checkHeader(opened.header, env.IMPORT_MAX_COLUMNS);
    const idFinder = new IdCandidateFinder(columns);
    const sampleRows: { rowNumber: number; values: (string | null)[] }[] = [];
    const problems: Problem[] = [];
    const addProblem = (problem: Problem) => {
      if (problems.length < MAX_PROBLEMS) problems.push(problem);
    };

    let rowsScanned = 0;
    let reachedEnd = false;
    try {
      for await (const row of opened.rows) {
        const values = row.values.map(normalizeCell);
        if (isEmptyRow(values)) continue; // lines like ",,,"
        rowsScanned++;

        const widthProblem = rowWidthProblem(row.rowNumber, row.values.length, columns.length);
        if (widthProblem) addProblem(widthProblem);

        // One value per column (missing ones = null, extra ones dropped from the preview).
        const aligned = columns.map((_, i) => values[i] ?? null);
        idFinder.add(aligned);
        if (sampleRows.length < PREVIEW_SAMPLE_ROWS)
          sampleRows.push({ rowNumber: row.rowNumber, values: aligned });

        if (rowsScanned >= PREVIEW_SCAN_ROWS) break;
      }
      reachedEnd = rowsScanned < PREVIEW_SCAN_ROWS;
    } catch (err) {
      // A broken row inside the preview area (e.g. an unclosed quote): show it, stop scanning.
      if (!(err instanceof SourceError)) throw err;
      addProblem({ row: err.rowNumber ?? null, message: err.message });
    }

    if (rowsScanned === 0 && problems.length === 0) {
      throw new AppError(400, 'SOURCE_INVALID', 'The file has a header row but no data rows', {
        details: [{ field: 'file', message: 'Add at least one row under the header' }],
      });
    }

    // Exact count if we read everything; otherwise estimated from how far into the file we are.
    const fraction = reachedEnd ? 1 : opened.progress?.();
    const totalRows = reachedEnd ? rowsScanned : null;
    const estimatedTotalRows = reachedEnd
      ? rowsScanned
      : fraction
        ? Math.round(rowsScanned / fraction)
        : null;
    if (estimatedTotalRows && estimatedTotalRows > env.IMPORT_MAX_ROWS) {
      addProblem({
        row: null,
        message: `This file has about ${estimatedTotalRows.toLocaleString('en')} rows; the limit is ${env.IMPORT_MAX_ROWS.toLocaleString('en')}`,
      });
    }

    const idCandidates = idFinder.candidates();
    return {
      kind: connector.kind,
      fileName: uploaded?.originalname ?? null,
      fileSize: uploaded?.size ?? null,
      columns, // names in file order; values are kept as text exactly as written
      sampleRows,
      rowsScanned, // how many rows the preview looked at
      totalRows, // exact, when the whole file fit in the preview; else null
      estimatedTotalRows,
      idCandidates, // unique + always present in the scanned rows; best guess first
      suggestedIdColumn: idCandidates[0] ?? null,
      problems,
    };
  } finally {
    opened.close(); // stop reading the rest of a big file
  }
}

// ───────────────────────────── Data sources + imports (task 2.3) ─────────────────────────────

// What the browser may see of a data source / an import (never temp paths or internal numbers).
export function toPublicDataSource(dataSource: DataSource) {
  return {
    id: dataSource.id,
    name: dataSource.name,
    kind: dataSource.kind,
    idColumn: dataSource.idColumn,
    columns: dataSource.columns as string[],
    rowCount: dataSource.rowCount,
    hasData: dataSource.activeGeneration !== null, // false until the first import succeeds
    lastImportAt: dataSource.lastImportAt,
    createdAt: dataSource.createdAt,
  };
}

export function toPublicImport(dataImport: DataImport) {
  return {
    id: dataImport.id,
    mode: dataImport.mode,
    status: dataImport.status, // queued | running | succeeded | failed
    fileName: dataImport.fileName,
    fileSize: dataImport.fileSize,
    processedRows: dataImport.processedRows,
    estimatedRows: dataImport.estimatedRows, // total rows (about) while running; exact at the end
    inserted: dataImport.inserted,
    updated: dataImport.updated,
    unchanged: dataImport.unchanged,
    deleted: dataImport.deleted,
    problems: dataImport.problems as Problem[],
    errorCode: dataImport.errorCode,
    startedAt: dataImport.startedAt,
    finishedAt: dataImport.finishedAt,
    createdAt: dataImport.createdAt,
  };
}

export async function findOwnedDataSource(organizationId: string, dataSourceId: string) {
  return prisma.dataSource.findFirst({ where: { id: dataSourceId, organizationId } });
}

// Reads ONLY the header (instant even for huge files) so the request can answer 400 right away
// for a broken header or a missing id column. Row-by-row checks happen in the background job.
async function checkSourceHeader(
  connector: SourceConnector,
  file: Express.Multer.File | undefined,
  idColumn: string,
) {
  const uploaded = checkUploadedFile(connector, file);
  const opened = await openSource(connector, {
    filePath: uploaded?.path,
    fileName: uploaded?.originalname,
    config: {},
  });
  try {
    const columns = checkHeader(opened.header, env.IMPORT_MAX_COLUMNS);
    const idIndex = findIdColumn(columns, idColumn);
    if (idIndex < 0) {
      throw new AppError(400, 'ID_COLUMN_NOT_FOUND', `Column "${idColumn}" isn't in this file`, {
        details: [
          { field: 'idColumn', message: `Pick one of: ${columns.slice(0, 20).join(', ')}` },
        ],
      });
    }
    return { uploaded, columns, idColumnName: columns[idIndex] };
  } finally {
    opened.close();
  }
}

// POST /data-sources: create the data source + its first import (runs in the background).
// The uploaded file now belongs to the import job, which deletes it when done.
export async function createDataSource(
  organizationId: string,
  input: CreateDataSourceInput,
  file: Express.Multer.File | undefined,
) {
  const connector = getConnector(input.kind);
  const { uploaded, columns, idColumnName } = await checkSourceHeader(
    connector,
    file,
    input.idColumn,
  );

  try {
    const { dataSource, dataImport } = await prisma.$transaction(async (tx) => {
      const dataSource = await tx.dataSource.create({
        data: {
          organizationId,
          name: input.name ?? uploaded?.originalname ?? connector.label,
          kind: connector.kind,
          idColumn: idColumnName,
          columns,
        },
      });
      const dataImport = await tx.dataImport.create({
        data: {
          organizationId,
          dataSourceId: dataSource.id,
          mode: 'initial',
          generation: 1,
          fileName: uploaded?.originalname,
          fileSize: uploaded?.size,
          tempPath: uploaded?.path,
        },
      });
      return { dataSource, dataImport };
    });
    enqueueImport(dataImport.id, dataImport.tempPath); // only after the transaction committed
    return { dataSource: toPublicDataSource(dataSource), import: toPublicImport(dataImport) };
  } catch (err) {
    if (isUniqueViolation(err, 'data_sources_organization_id_name_key')) {
      throw new AppError(
        409,
        'DATA_SOURCE_NAME_TAKEN',
        'A data source with this name already exists',
        {
          cause: err,
        },
      );
    }
    throw err;
  }
}

// POST /data-sources/:id/imports: upload a new version (replace or merge), in the background.
export async function startImport(
  dataSource: DataSource,
  input: StartImportInput,
  file: Express.Multer.File | undefined,
) {
  const connector = getConnector(dataSource.kind);
  const { uploaded, columns } = await checkSourceHeader(connector, file, dataSource.idColumn);

  // Data guard (3.6): a replace must keep every column the APIs on this data send. (A merge
  // keeps all old columns, so it can't remove one.) Checked again at the switch.
  if (input.mode === 'replace') {
    const blocked = await apisMissingColumns(prisma, dataSource.id, columns);
    if (blocked.length > 0) {
      throw new AppError(
        409,
        'COLUMNS_IN_USE',
        "This file is missing columns that APIs send. Add them to the file, or change those APIs' designs first.",
        { details: blocked.map((api) => ({ field: 'file', message: describeMissing(api) })) },
      );
    }
  }

  // A brand-new generation number: above the live one and above any earlier attempt.
  const last = await prisma.dataImport.aggregate({
    where: { dataSourceId: dataSource.id },
    _max: { generation: true },
  });
  const generation = Math.max(dataSource.activeGeneration ?? 0, last._max.generation ?? 0) + 1;

  try {
    const dataImport = await prisma.dataImport.create({
      data: {
        organizationId: dataSource.organizationId,
        dataSourceId: dataSource.id,
        mode: input.mode,
        generation,
        fileName: uploaded?.originalname,
        fileSize: uploaded?.size,
        tempPath: uploaded?.path,
      },
    });
    enqueueImport(dataImport.id, dataImport.tempPath);
    return { import: toPublicImport(dataImport) };
  } catch (err) {
    // The database allows only ONE queued/running import per data source (partial unique index).
    if (isUniqueViolation(err, 'data_imports_one_active_per_data_source')) {
      throw new AppError(
        409,
        'IMPORT_IN_PROGRESS',
        'An import is already running for this data source',
        {
          cause: err,
        },
      );
    }
    // The data source was deleted a moment ago (after requireDataSource found it).
    if (isForeignKeyViolation(err)) {
      throw new AppError(404, 'DATA_SOURCE_NOT_FOUND', 'Data source not found', { cause: err });
    }
    throw err;
  }
}

// GET /data-sources/:id/imports/:importId (the browser polls this for progress)
export async function getImport(dataSourceId: string, importId: string) {
  const dataImport = await prisma.dataImport.findFirst({ where: { id: importId, dataSourceId } });
  if (!dataImport) throw new AppError(404, 'IMPORT_NOT_FOUND', 'Import not found');
  return { import: toPublicImport(dataImport) };
}

// ─────────────────────── Reading + deleting data sources (task 2.4) ───────────────────────

// An import in one of these states holds the data source: only one at a time (partial unique
// index), and the data source can't be deleted under it.
const ACTIVE_IMPORT_STATUSES = ['queued', 'running'];

// Everything the list / detail page shows, loaded in ONE Prisma query per call:
// the APIs that use the data source and its most recent import (for "Importing… 40%").
const withUsageAndLatestImport = {
  apis: { select: { id: true, name: true, slug: true, status: true }, orderBy: { name: 'asc' } },
  imports: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.DataSourceInclude;

type DataSourceWithUsage = Prisma.DataSourceGetPayload<{
  include: typeof withUsageAndLatestImport;
}>;

function toDataSourceDetails({ apis, imports, ...dataSource }: DataSourceWithUsage) {
  return {
    ...toPublicDataSource(dataSource),
    usedBy: apis, // [] = no API uses it (it can be deleted)
    latestImport: imports[0] ? toPublicImport(imports[0]) : null,
  };
}

// GET /data-sources: this brand's data sources, newest first.
// No paging: a brand has a handful of data sources (each can hold 1 000 000 rows).
export async function listDataSources(organizationId: string) {
  const dataSources = await prisma.dataSource.findMany({
    where: { organizationId },
    include: withUsageAndLatestImport,
    orderBy: { createdAt: 'desc' },
  });
  return { dataSources: dataSources.map(toDataSourceDetails) };
}

// GET /data-sources/:id (requireDataSource already checked that it's this brand's)
export async function getDataSource(dataSourceId: string) {
  const dataSource = await prisma.dataSource.findUnique({
    where: { id: dataSourceId },
    include: withUsageAndLatestImport,
  });
  if (!dataSource) throw new AppError(404, 'DATA_SOURCE_NOT_FOUND', 'Data source not found');
  return { dataSource: toDataSourceDetails(dataSource) };
}

// GET /data-sources/:id/imports: the 20 most recent imports (history on the Data tab).
export async function listImports(dataSourceId: string) {
  const imports = await prisma.dataImport.findMany({
    where: { dataSourceId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return { imports: imports.map(toPublicImport) };
}

type RecordRow = { position: number; external_id: string; data: Record<string, string | null> };

// GET /data-sources/:id/records: one page of rows of the LIVE version.
//
// Why a REPEATABLE READ transaction: we read "which version is live" and then that version's
// rows. Without it, an import could switch versions (and delete the old one) between the two
// reads and we'd return an empty page. In REPEATABLE READ both reads see the database exactly
// as it was when the first one ran, so a page is always one complete version.
export async function listRecords(dataSourceId: string, query: ListRecordsInput) {
  return prisma.$transaction(
    async (tx) => {
      const dataSource = await tx.dataSource.findUnique({ where: { id: dataSourceId } });
      if (!dataSource) throw new AppError(404, 'DATA_SOURCE_NOT_FOUND', 'Data source not found');
      const columns = dataSource.columns as string[];
      const generation = dataSource.activeGeneration;
      const searching = query.search !== undefined;
      if (generation === null) {
        return { columns, idColumn: dataSource.idColumn, total: 0, records: [], next: null };
      }

      // Fetch one row more than asked: if it exists, there is a next page.
      const take = query.limit + 1;
      let rows: RecordRow[];
      if (searching) {
        // Id prefix search, sorted by id. external_id is COLLATE "C", so Postgres turns
        // LIKE 'SKU-12%' into a range on the unique index (data_source_id, generation,
        // external_id): it reads only the matching rows, never the whole data source.
        const pattern = escapeLike(query.search!) + '%';
        rows = await tx.$queryRaw<RecordRow[]>`
          SELECT position, external_id, data FROM records
          WHERE data_source_id = ${dataSourceId} AND generation = ${generation}
            AND external_id LIKE ${pattern}
            ${query.afterId === undefined ? Prisma.empty : Prisma.sql`AND external_id > ${query.afterId}`}
          ORDER BY external_id
          LIMIT ${take}`;
      } else {
        // File order, through the index (data_source_id, generation, position).
        rows = await tx.$queryRaw<RecordRow[]>`
          SELECT position, external_id, data FROM records
          WHERE data_source_id = ${dataSourceId} AND generation = ${generation}
            AND position > ${query.afterPosition ?? 0}
          ORDER BY position
          LIMIT ${take}`;
      }

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        columns, // in file order; `values` below follow the same order
        idColumn: dataSource.idColumn,
        // Rows in the live version (no count for searches: counting every "S…" match would
        // read the whole index; the page and `next` are enough to show results).
        total: searching ? null : dataSource.rowCount,
        records: page.map((row) => ({
          position: row.position,
          id: row.external_id,
          // A row's cells in column order (the id goes back in its own column). A column added
          // by a later merge is null for rows that didn't have it.
          values: columns.map((name) =>
            name === dataSource.idColumn ? row.external_id : (row.data[name] ?? null),
          ),
        })),
        // What to send to get the next page (null = this was the last one).
        next:
          hasMore && last
            ? searching
              ? { afterId: last.external_id }
              : { afterPosition: last.position }
            : null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

// In LIKE, % and _ are wildcards and \ escapes: a search for "A_1" must mean exactly "A_1".
function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// 409 DATA_SOURCE_IN_USE, listing the APIs, so the user knows what to change first.
function inUseError(apis: { name: string; slug: string }[], cause?: unknown) {
  const names = apis.map((api) => `"${api.name}"`).join(', ');
  return new AppError(
    409,
    'DATA_SOURCE_IN_USE',
    apis.length > 0
      ? `This data is used by ${names}. Delete those APIs or switch them to other data first.`
      : 'This data is used by an API. Delete that API first.',
    {
      details: apis.map((api) => ({ field: `apis.${api.slug}`, message: `Used by "${api.name}"` })),
      cause,
    },
  );
}

async function apisUsing(dataSourceId: string) {
  return prisma.api.findMany({
    where: { dataSourceId },
    select: { name: true, slug: true },
    orderBy: { name: 'asc' },
  });
}

// DELETE /data-sources/:id: the data source, all its rows and its import history.
//   - used by an API          → 409 DATA_SOURCE_IN_USE (the API would have no data)
//   - an import is running    → 409 IMPORT_IN_PROGRESS (wait for it, then delete)
export async function deleteDataSource(dataSource: DataSource) {
  // Friendly fast answer for the common case (an API is linked).
  const usedBy = await apisUsing(dataSource.id);
  if (usedBy.length > 0) throw inUseError(usedBy);

  try {
    // ONE statement: "delete it, unless an import is active". Postgres checks and deletes
    // together, so an import can't slip in between a separate check and the delete.
    // Rows (records) and imports go with it (ON DELETE CASCADE).
    const { count } = await prisma.dataSource.deleteMany({
      where: {
        id: dataSource.id,
        organizationId: dataSource.organizationId,
        imports: { none: { status: { in: ACTIVE_IMPORT_STATUSES } } },
      },
    });
    if (count === 1) return;
  } catch (err) {
    // An API was linked between our check and the delete: the foreign key (NO ACTION) refused.
    if (isForeignKeyViolation(err)) throw inUseError(await apisUsing(dataSource.id), err);
    throw err;
  }

  // Nothing deleted: either an import is active, or someone else deleted it a moment ago.
  const active = await prisma.dataImport.count({
    where: { dataSourceId: dataSource.id, status: { in: ACTIVE_IMPORT_STATUSES } },
  });
  if (active > 0) {
    throw new AppError(
      409,
      'IMPORT_IN_PROGRESS',
      'An import is running for this data source. Wait until it finishes, then delete it.',
    );
  }
  throw new AppError(404, 'DATA_SOURCE_NOT_FOUND', 'Data source not found');
}
