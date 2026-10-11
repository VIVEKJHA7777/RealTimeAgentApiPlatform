// Runs ONE import from start to finish. Source-independent: it only talks to a connector
// (header + rows), so CSV, JSON or Google Sheets all go through exactly this code.
//
//   queued → running → read + check every row → COPY into generation N (invisible)
//          → (merge: carry over untouched rows) → counts → SWITCH (one small transaction)
//          → delete the old generation → succeeded
//   any problem → failed (+ up to 5 problems with row numbers); generation N removed;
//                 the live data was never touched.
import { rm } from 'node:fs/promises';
import { Prisma } from '../../../generated/prisma/client.js';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/app-error.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { SourceError, type OpenedSource, type SourceInput } from '../connectors/connector.js';
import { getConnector } from '../connectors/index.js';
import {
  MAX_PROBLEMS,
  checkHeader,
  isEmptyRow,
  normalizeCell,
  rowWidthProblem,
  type Problem,
} from '../source-rules.js';
import { apisMissingColumns, describeMissing } from '../../apis/design/column-guard.js';
import { CopyWriter } from './copy-writer.js';

const PROGRESS_EVERY_ROWS = 10_000; // how often processed_rows is saved (for the progress bar)
const ANALYZE_FROM_ROWS = 10_000; // refresh table statistics before comparing versions this big

// The id column inside a header (exact name first, then ignoring upper/lower case), or -1.
export function findIdColumn(columns: string[], idColumn: string): number {
  const exact = columns.indexOf(idColumn);
  return exact >= 0 ? exact : columns.findIndex((c) => c.toLowerCase() === idColumn.toLowerCase());
}

// A failure the user should see (problems with row numbers + a code), not a bug.
class ImportFailure extends Error {
  constructor(
    readonly code: string,
    readonly problems: Problem[],
  ) {
    super(problems[0]?.message ?? code);
  }
}

// The data source disappeared (or changed) between the start of the import and the switch.
class DataSourceGone extends Error {}

type Job = Prisma.DataImportGetPayload<{ include: { dataSource: true } }>;

export async function runImport(importId: string, tempPath: string | null): Promise<void> {
  // Claim the job: only a queued import can start (protects against starting it twice).
  const claimed = await prisma.dataImport.updateMany({
    where: { id: importId, status: 'queued' },
    data: { status: 'running', startedAt: new Date() },
  });
  const job =
    claimed.count === 1
      ? await prisma.dataImport.findUnique({
          where: { id: importId },
          include: { dataSource: true },
        })
      : null;
  if (!job) {
    // The import row is gone (deleted with its data source / brand before the job started):
    // nobody else will remove its uploaded file. (If the row still exists, another run owns it.)
    const gone = (await prisma.dataImport.count({ where: { id: importId } })) === 0;
    if (gone && tempPath) await rm(tempPath, { force: true });
    return;
  }

  const log = logger.child({ importId, dataSourceId: job.dataSourceId, mode: job.mode });
  const started = Date.now();
  try {
    const result = await importRows(job);
    log.info({ ...result, ms: Date.now() - started }, 'Import succeeded');
  } catch (err) {
    // Deleted while we were importing (e.g. the brand was removed)? A normal situation, not a
    // bug: COPY then fails on the foreign key, or the switch finds nothing to switch.
    const gone =
      err instanceof DataSourceGone ||
      (await prisma.dataSource.count({ where: { id: job.dataSourceId } })) === 0;
    const failure = gone
      ? new ImportFailure('DATA_SOURCE_DELETED', [
          { row: null, message: 'The data source was deleted during the import' },
        ])
      : err instanceof ImportFailure
        ? err
        : err instanceof SourceError
          ? new ImportFailure('SOURCE_INVALID', [
              { row: err.rowNumber ?? null, message: err.message },
            ])
          : err instanceof AppError
            ? new ImportFailure(err.code, [{ row: null, message: err.message }])
            : null;
    if (failure) {
      log.warn({ code: failure.code, problems: failure.problems }, 'Import failed (data problem)');
    } else {
      log.error({ err }, 'Import failed (unexpected error)');
    }
    await markFailed(
      job,
      failure?.code ?? 'INTERNAL_ERROR',
      failure?.problems ?? [
        { row: null, message: 'Something went wrong while importing. Try again.' },
      ],
    );
  } finally {
    if (job.tempPath) await rm(job.tempPath, { force: true });
  }
}

async function importRows(job: Job) {
  const { dataSource } = job;
  const connector = getConnector(dataSource.kind);
  const input: SourceInput = {
    filePath: job.tempPath ?? undefined,
    fileName: job.fileName ?? undefined,
    config: (dataSource.config ?? {}) as Record<string, unknown>,
  };

  // ── 1. Read every row, check it, stream it into generation N ──────────────────────────
  const opened = await connector.open(input);
  let fileRows = 0;
  let columns: string[];
  const duplicateIds = new Map<string, number>(); // id → row of the 2nd occurrence
  try {
    columns = checkHeader(opened.header, env.IMPORT_MAX_COLUMNS);
    const idIndex = findIdColumn(columns, dataSource.idColumn);
    if (idIndex < 0) {
      throw new ImportFailure('ID_COLUMN_NOT_FOUND', [
        { row: 1, message: `Column "${dataSource.idColumn}" isn't in this file` },
      ]);
    }
    fileRows = await streamRows(job, opened, columns, idIndex, duplicateIds);
  } finally {
    opened.close();
  }

  // ── 2. Merge / counts (generation N is complete but not live yet) ─────────────────────
  // Fresh statistics before comparing BIG versions: Postgres has never seen the rows we just
  // loaded and could pick a plan that compares every new row with every old one (6+ minutes
  // for 500 000 rows instead of under a second). ANALYZE samples the table (~0.2 s, more when
  // the table holds many deleted rows), so small imports skip it: nested loops are switched
  // off below anyway, which already prevents the slow plan.
  const analyzedBeforeCompare = dataSource.activeGeneration !== null && fileRows >= ANALYZE_FROM_ROWS;
  if (analyzedBeforeCompare) {
    await prisma.$executeRawUnsafe('ANALYZE records');
  }
  const oldGeneration = dataSource.activeGeneration;
  const counts = await prisma.$transaction(
    async (tx) => {
      // Safety net on top of ANALYZE: these bulk compares must use hash joins, never
      // row-by-row nested loops. SET LOCAL only affects this transaction.
      await tx.$executeRaw`SET LOCAL enable_nestloop = off`;
      const counts = await countChanges(tx, job, oldGeneration, fileRows);
      if (job.mode === 'merge' && oldGeneration !== null) {
        await carryOverUntouchedRows(tx, job, oldGeneration, fileRows);
      }
      return counts;
    },
    // Prisma's default is 5 s; carrying over 500 000 rows in merge mode takes ~8 s.
    { maxWait: 10_000, timeout: 10 * 60_000 },
  );
  const rowCount = job.mode === 'merge' ? fileRows + counts.keptFromOld : fileRows;
  const newColumns =
    job.mode === 'merge'
      ? [...new Set([...(dataSource.columns as string[]), ...columns])] // old order, new ones at the end
      : columns;

  // Fresh statistics BEFORE the switch too (task 4.8): the live API (/v1) looks rows up by
  // (data source, generation, id). With stale statistics Postgres believes the new generation has
  // ~1 row and scans all of it for every call: 735 ms instead of 1 ms on 500 000 rows, which under
  // load ran the connection pool dry (500s). Needed for a FIRST upload (no compare ran ANALYZE)
  // and after a merge (the carried-over rows came after that ANALYZE). Done before the switch, so
  // no live call ever sees the slow plan.
  if (rowCount >= ANALYZE_FROM_ROWS && (!analyzedBeforeCompare || job.mode === 'merge')) {
    await prisma.$executeRawUnsafe('ANALYZE records');
  }

  // ── 3. Switch: one small transaction makes generation N the live data ─────────────────
  await prisma.$transaction(async (tx) => {
    const switched = await tx.dataSource.updateMany({
      // Only if nobody else switched in the meantime (can't happen: one active import per data
      // source is enforced by the database, but this keeps the switch safe on its own).
      where: { id: dataSource.id, activeGeneration: oldGeneration },
      data: {
        activeGeneration: job.generation,
        rowCount,
        columns: newColumns,
        lastImportAt: new Date(),
      },
    });
    if (switched.count !== 1) throw new DataSourceGone();
    // Data guard (3.6), the final check. The UPDATE above locked the data source row, and a
    // design save holds a share lock on it while it checks: so every design saved before this
    // moment is visible here, and every later save checks against the NEW columns. A column
    // still in use → throwing rolls the switch back; the old version stays live.
    const blocked = await apisMissingColumns(tx, dataSource.id, newColumns);
    if (blocked.length > 0) {
      throw new ImportFailure(
        'COLUMNS_IN_USE',
        blocked.map((api) => ({ row: null, message: describeMissing(api) })),
      );
    }
    await tx.dataImport.update({
      where: { id: job.id },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        processedRows: fileRows,
        inserted: counts.inserted,
        updated: counts.updated,
        unchanged: counts.unchanged,
        deleted: job.mode === 'merge' ? 0 : counts.deleted,
        problems: [],
      },
    });
  });

  // ── 4. Remove the old version (nobody reads it any more) ──────────────────────────────
  // The import already succeeded: if this clean-up fails, don't report a failure; the rows
  // are invisible (not the live generation) and are removed at the next server start.
  if (oldGeneration !== null) {
    await deleteGeneration(dataSource.id, oldGeneration).catch((err) =>
      logger.warn({ err, importId: job.id }, 'Could not delete the old version yet'),
    );
  }
  return { rowCount, fileRows, ...counts };
}

// Reads all rows: checks each one, writes good rows with COPY. Returns the number of rows.
// On the first problem it STOPS writing (the import will fail anyway) and only keeps reading
// to collect up to MAX_PROBLEMS problems; then the COPY is cancelled → nothing stored.
async function streamRows(
  job: Job,
  opened: OpenedSource,
  columns: string[],
  idIndex: number,
  duplicateIds: Map<string, number>,
): Promise<number> {
  const idColumn = columns[idIndex];
  const problems: Problem[] = [];
  const addProblem = (problem: Problem) => problems.push(problem);
  const seenIds = new Set<string>(); // ~50 MB for 500 000 ids: fine
  const writer = await CopyWriter.open(job.organizationId, job.dataSourceId, job.generation);

  let position = 0;
  try {
    for await (const row of opened.rows) {
      const values = row.values.map(normalizeCell);
      if (isEmptyRow(values)) continue;

      const widthProblem = rowWidthProblem(row.rowNumber, row.values.length, columns.length);
      const id = values[idIndex] ?? null;
      if (widthProblem) addProblem(widthProblem);
      else if (id === null)
        addProblem({ row: row.rowNumber, message: `Row ${row.rowNumber} has no "${idColumn}"` });
      else if (seenIds.has(id)) {
        duplicateIds.set(id, row.rowNumber);
        addProblem({
          row: row.rowNumber,
          message: `"${id}" appears more than once (row ${row.rowNumber})`,
        });
      } else {
        seenIds.add(id);
        if (position + 1 > env.IMPORT_MAX_ROWS) {
          addProblem({
            row: row.rowNumber,
            message: `The file has more than ${env.IMPORT_MAX_ROWS.toLocaleString('en')} rows (the limit)`,
          });
        }
      }
      if (problems.length >= MAX_PROBLEMS || position + 1 > env.IMPORT_MAX_ROWS) break;
      if (problems.length > 0) continue; // failing anyway: don't write, just look for more problems

      const data: Record<string, string | null> = {};
      columns.forEach((name, i) => {
        if (i !== idIndex) data[name] = values[i] ?? null;
      });
      position++;
      await writer.write(id!, position, data);

      if (position % PROGRESS_EVERY_ROWS === 0) {
        // progress() = share of the file read so far (0–1), from the connector.
        const fraction = opened.progress?.();
        await prisma.dataImport.update({
          where: { id: job.id },
          data: {
            processedRows: position,
            ...(fraction && { estimatedRows: Math.max(position, Math.round(position / fraction)) }),
          },
        });
      }
    }
  } catch (err) {
    await writer.abort();
    throw err;
  }

  if (problems.length > 0) {
    await writer.abort();
    // Duplicates: tell the user where the FIRST copy is too (one quick second pass).
    if (duplicateIds.size > 0) await addFirstOccurrences(job, problems, duplicateIds);
    throw new ImportFailure(
      problems.some((p) => p.message.includes('appears more than once'))
        ? 'DUPLICATE_IDS'
        : 'SOURCE_INVALID',
      problems.slice(0, MAX_PROBLEMS),
    );
  }

  await writer.finish(); // COPY commits: generation N exists (not live yet)
  await prisma.dataImport.update({
    where: { id: job.id },
    data: { processedRows: position, estimatedRows: position }, // now exact
  });
  return position;
}

// '"SKU-1" appears more than once (row 19)' → '"SKU-1" appears more than once (rows 2 and 19)'
async function addFirstOccurrences(
  job: Job,
  problems: Problem[],
  duplicateIds: Map<string, number>,
) {
  const firstRow = new Map<string, number>();
  const opened = await getConnector(job.dataSource.kind).open({
    filePath: job.tempPath ?? undefined,
    config: (job.dataSource.config ?? {}) as Record<string, unknown>,
  });
  try {
    const idIndex = findIdColumn(
      opened.header.map((h) => h.trim()),
      job.dataSource.idColumn,
    );
    for await (const row of opened.rows) {
      const id = normalizeCell(row.values[idIndex]);
      if (id !== null && duplicateIds.has(id) && !firstRow.has(id)) {
        firstRow.set(id, row.rowNumber);
        if (firstRow.size === duplicateIds.size) break;
      }
    }
  } catch {
    return; // best effort: the problem is already reported without the first row
  } finally {
    opened.close();
  }
  for (const problem of problems) {
    for (const [id, secondRow] of duplicateIds) {
      if (problem.row === secondRow && firstRow.has(id)) {
        problem.message = `"${id}" appears more than once (rows ${firstRow.get(id)} and ${secondRow})`;
      }
    }
  }
}

// inserted / updated / unchanged: rows of the FILE compared with the live version.
// deleted: live rows the file doesn't have (replace mode removes them; merge keeps them).
async function countChanges(
  db: Prisma.TransactionClient,
  job: Job,
  oldGeneration: number | null,
  fileRows: number,
) {
  if (oldGeneration === null) {
    return { inserted: fileRows, updated: 0, unchanged: 0, deleted: 0, keptFromOld: 0 };
  }
  const [row] = await db.$queryRaw<
    { inserted: bigint; updated: bigint; unchanged: bigint; old_total: bigint }[]
  >`
    SELECT
      count(*) FILTER (WHERE o.external_id IS NULL)                         AS inserted,
      count(*) FILTER (WHERE o.external_id IS NOT NULL AND o.data <> n.data) AS updated,
      count(*) FILTER (WHERE o.external_id IS NOT NULL AND o.data = n.data)  AS unchanged,
      (SELECT count(*) FROM records WHERE data_source_id = ${job.dataSourceId}
                                      AND generation = ${oldGeneration})     AS old_total
    FROM records n
    LEFT JOIN records o
      ON o.data_source_id = n.data_source_id AND o.generation = ${oldGeneration}
     AND o.external_id = n.external_id
    WHERE n.data_source_id = ${job.dataSourceId} AND n.generation = ${job.generation}`;
  const inserted = Number(row.inserted);
  const updated = Number(row.updated);
  const unchanged = Number(row.unchanged);
  const notInFile = Number(row.old_total) - updated - unchanged;
  return { inserted, updated, unchanged, deleted: notInFile, keptFromOld: notInFile };
}

// Merge mode: copy live rows that the file didn't mention into generation N (after the file's rows).
async function carryOverUntouchedRows(
  db: Prisma.TransactionClient,
  job: Job,
  oldGeneration: number,
  fileRows: number,
) {
  await db.$executeRaw`
    INSERT INTO records (organization_id, data_source_id, generation, external_id, position, data)
    SELECT o.organization_id, o.data_source_id, ${job.generation}, o.external_id,
           ${fileRows} + row_number() OVER (ORDER BY o.position), o.data
    FROM records o
    WHERE o.data_source_id = ${job.dataSourceId} AND o.generation = ${oldGeneration}
      AND NOT EXISTS (SELECT 1 FROM records n
                      WHERE n.data_source_id = o.data_source_id AND n.generation = ${job.generation}
                        AND n.external_id = o.external_id)`;
}

// Failed: record why, and remove anything written into generation N. Never throws.
export async function markFailed(
  job: { id: string; dataSourceId: string; generation: number },
  code: string,
  problems: Problem[],
) {
  try {
    await prisma.dataImport.updateMany({
      where: { id: job.id, status: { in: ['queued', 'running'] } },
      data: { status: 'failed', errorCode: code, problems, finishedAt: new Date() },
    });
    await deleteGeneration(job.dataSourceId, job.generation);
  } catch (err) {
    logger.error({ err, importId: job.id }, 'Could not mark the import as failed');
  }
}

// Removes the rows of one NON-live generation (never the live one: the guard is in the SQL).
//
// Lock order matters (found in task 2.4: a deadlock, P2034). Deleting a data source locks its
// row first and then deletes all its records (ON DELETE CASCADE). If we deleted records
// first and only then touched the data source, the two deletes could each hold rows the
// other needs, and Postgres would kill one of them. So we take the SAME order: a share lock
// on the data source row first. A data source delete arriving meanwhile simply waits for us.
export async function deleteGeneration(dataSourceId: string, generation: number) {
  await prisma.$transaction(
    async (tx) => {
      // FOR KEY SHARE: blocks a DELETE of the data source, not other reads/updates of it.
      await tx.$queryRaw`SELECT 1 FROM data_sources WHERE id = ${dataSourceId} FOR KEY SHARE`;
      await tx.$executeRaw`
        DELETE FROM records r
        WHERE r.data_source_id = ${dataSourceId} AND r.generation = ${generation}
          AND r.generation IS DISTINCT FROM (SELECT active_generation FROM data_sources WHERE id = ${dataSourceId})`;
    },
    { maxWait: 10_000, timeout: 10 * 60_000 }, // 500 000 rows take ~1–2 s; Prisma's default is 5 s
  );
}
