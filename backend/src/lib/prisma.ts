// One shared database client for the whole app.
// Creating a new client per request would open a new connection pool each time.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  // Give up quickly if the database is unreachable, instead of hanging.
  connectionTimeoutMillis: 3000,
  // How many connections at most (DB_POOL_MAX, default 10). Waiting longer than the 3 s above for a
  // free one fails the request (/v1 answers 503 "busy" then, see modules/v1/v1.routes.ts).
  max: env.DB_POOL_MAX,
  // Make every connection use UTC. The pg adapter sends timestamps WITHOUT a timezone
  // marker; if the DB server runs in another zone (this Mac: Asia/Kolkata), Postgres
  // would read them as local time and store them 5h30 off. Found in task 1.3.
  options: '-c timezone=UTC',
});

export const prisma = new PrismaClient({ adapter });
