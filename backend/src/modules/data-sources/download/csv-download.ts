// GET /data-sources/:id/download: the live version as a CSV file, in file order.
//
// How a 500 000-row download stays cheap:
//   - Postgres itself writes the CSV (COPY ... TO STDOUT WITH (FORMAT csv)) and we pipe those
//     bytes straight to the browser. Node never holds more than a small chunk in memory, and
//     the speed is that of the database (~1 s for 500 000 rows), not of a JS loop.
//   - pipeline() handles backpressure: if the browser downloads slowly, Postgres is paused.
//   - The whole download runs in ONE read-only REPEATABLE READ transaction: an import that
//     finishes in the middle doesn't mix two versions; the file is exactly one version.
//   - At most DOWNLOAD_CONCURRENCY downloads at once (each holds a connection); more → 429,
//     so downloads can never take the connections that imports need.
//
// Postgres' CSV rules match the usual ones: a value is quoted only if it contains a comma,
// a quote ("" inside), or a line break; "no value" (null) is an empty cell. So a typical file
// (comma, LF line ends, no needless quotes) downloads byte for byte as it was uploaded.
import { pipeline } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import type { PoolClient } from 'pg';
import { to as copyTo } from 'pg-copy-streams';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/app-error.js';
import { pgPool } from '../../../lib/pg-pool.js';

let activeDownloads = 0;

export type CsvDownload = {
  fileName: string;
  // Streams the file into `out` (header row first). Always gives the DB connection back.
  pipeTo(out: Writable): Promise<void>;
};

// Checks everything that can still become a normal JSON error (busy, not found, no data yet)
// BEFORE the first byte is sent; after that, the answer is the CSV stream.
export async function openCsvDownload(
  organizationId: string,
  dataSourceId: string,
): Promise<CsvDownload> {
  if (activeDownloads >= env.DOWNLOAD_CONCURRENCY) {
    throw new AppError(
      429, // "Too Many Requests": try again later
      'TOO_MANY_DOWNLOADS',
      'Too many downloads right now. Try again in a minute.',
    );
  }
  activeDownloads++;
  let client: PoolClient | undefined;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // Same brand check as everywhere (id AND organization), inside the download's snapshot.
    const { rows } = await client.query<{
      name: string;
      id_column: string;
      columns: string[];
      active_generation: number | null;
    }>(
      `SELECT name, id_column, columns, active_generation FROM data_sources
       WHERE id = $1 AND organization_id = $2`,
      [dataSourceId, organizationId],
    );
    const dataSource = rows[0];
    if (!dataSource) throw new AppError(404, 'DATA_SOURCE_NOT_FOUND', 'Data source not found');
    if (dataSource.active_generation === null) {
      throw new AppError(
        409,
        'NO_DATA_YET',
        'There is no data to download yet (the first import has not finished)',
      );
    }

    const sql = copySql(client, dataSourceId, dataSource);
    const header = dataSource.columns.map(csvField).join(',') + '\n';
    const connection = client;
    return {
      fileName: downloadFileName(dataSource.name),
      async pipeTo(out) {
        try {
          await pipeline(async function* () {
            yield header;
            yield* connection.query(copyTo(sql));
          }, out);
          await connection.query('COMMIT');
          finish(connection);
        } catch (err) {
          // Browser gone or DB error mid-COPY: the connection is in an unknown state → close it.
          finish(connection, err);
          throw err;
        }
      },
    };
  } catch (err) {
    if (client) {
      const rolledBack = await client.query('ROLLBACK').then(
        () => true,
        () => false,
      );
      finish(client, rolledBack ? undefined : err);
    } else {
      activeDownloads--;
    }
    throw err;
  }
}

function finish(client: PoolClient, err?: unknown) {
  client.release(err instanceof Error ? err : undefined); // with an error: destroyed, not reused
  activeDownloads--;
}

// COPY can't take $1 parameters, so every value inside it is escaped with the driver's own
// escapeLiteral (column names are user data: a name like  a'); DROP TABLE x; --  stays text).
function copySql(
  client: PoolClient,
  dataSourceId: string,
  dataSource: { id_column: string; columns: string[]; active_generation: number | null },
) {
  const cells = dataSource.columns.map((name) =>
    name === dataSource.id_column ? 'external_id' : `data ->> ${client.escapeLiteral(name)}`,
  );
  return `COPY (
    SELECT ${cells.join(', ')} FROM records
    WHERE data_source_id = ${client.escapeLiteral(dataSourceId)}
      AND generation = ${Number(dataSource.active_generation)}
    ORDER BY position
  ) TO STDOUT WITH (FORMAT csv)`;
}

// Header cells follow the same quoting rule as Postgres uses for the values.
function csvField(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// "Spring products" → "Spring products.csv"; "products.csv" stays as it is.
function downloadFileName(name: string) {
  return /\.csv$/i.test(name) ? name : `${name}.csv`;
}
