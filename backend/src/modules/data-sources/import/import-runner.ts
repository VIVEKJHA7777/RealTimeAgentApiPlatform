// The background queue for imports, inside our own server (no Redis needed).
//
// - enqueueImport(id, tempPath): run it as soon as a slot is free (IMPORT_CONCURRENCY at the
//   same time). The file path travels with the job so the file is removed even if the import
//   row disappears before the job starts (e.g. deleted together with its brand).
//   The job's state lives in the data_imports table, so the browser can poll progress.
// - recoverImports(): at server start, imports that were queued/running when the server stopped
//   are marked failed ("interrupted"), and their half-written rows and temp files are removed.
//
// Note: assumes ONE server process (true for this project). With several, recovery would need
// a "which server owns this job" column; that's out of scope.
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { UPLOAD_DIR } from '../../../middleware/upload-file.js';
import { markFailed, runImport } from './import-engine.js';

const queue: { importId: string; tempPath: string | null }[] = [];
let running = 0;

export function enqueueImport(importId: string, tempPath: string | null) {
  queue.push({ importId, tempPath });
  pump();
}

function pump() {
  while (running < env.IMPORT_CONCURRENCY && queue.length > 0) {
    const { importId, tempPath } = queue.shift()!;
    running++;
    runImport(importId, tempPath)
      .catch((err) => logger.error({ err, importId }, 'Import crashed'))
      .finally(() => {
        running--;
        pump();
      });
  }
}

const STALE_UPLOAD_MS = 60 * 60 * 1000; // leftover upload files older than 1 hour are deleted

export async function recoverImports() {
  // 1. Imports cut off by a stop/crash: failed + clean up their rows and files.
  const interrupted = await prisma.dataImport.findMany({
    where: { status: { in: ['queued', 'running'] } },
    select: { id: true, dataSourceId: true, generation: true, tempPath: true },
  });
  for (const job of interrupted) {
    await markFailed(job, 'INTERRUPTED', [
      { row: null, message: 'The server restarted during the import. Upload the file again.' },
    ]);
    if (job.tempPath) await rm(job.tempPath, { force: true });
  }

  // 2. Old generations left behind if the server stopped right after a switch.
  const orphans = await prisma.$executeRaw`
    DELETE FROM records r USING data_sources ds
    WHERE r.data_source_id = ds.id AND r.generation IS DISTINCT FROM ds.active_generation`;

  // 3. Upload files nobody is waiting for any more.
  let staleFiles = 0;
  for (const name of await readdir(UPLOAD_DIR)) {
    const file = path.join(UPLOAD_DIR, name);
    const { mtimeMs } = await stat(file);
    if (Date.now() - mtimeMs > STALE_UPLOAD_MS) {
      await rm(file, { force: true });
      staleFiles++;
    }
  }

  if (interrupted.length || orphans || staleFiles) {
    logger.warn(
      { interruptedImports: interrupted.length, orphanRows: orphans, staleUploadFiles: staleFiles },
      'Recovered after restart',
    );
  }
}
