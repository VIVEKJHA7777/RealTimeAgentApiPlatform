// A small plain `pg` connection pool, used ONLY for Postgres COPY, which Prisma doesn't support:
// COPY ... FROM STDIN (imports: bulk loading rows) and COPY ... TO STDOUT (CSV downloads).
// Everything else goes through Prisma (lib/prisma.ts).
import pg from 'pg';
import { env } from '../config/env.js';

export const pgPool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  // One per running import + one per running download (both are limited), plus one spare.
  max: env.IMPORT_CONCURRENCY + env.DOWNLOAD_CONCURRENCY + 1,
  connectionTimeoutMillis: 3000,
  options: '-c timezone=UTC', // same reason as in lib/prisma.ts
});
