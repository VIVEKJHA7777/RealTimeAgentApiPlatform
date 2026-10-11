// SERVICE layer for health: talks to the database, knows nothing about HTTP.
import { prisma } from '../../lib/prisma.js';

export type DatabaseStatus = { db: 'up' } | { db: 'down'; reason: string };

// A health check must never throw: "DB is down" is an answer, not an error.
export async function checkDatabase(): Promise<DatabaseStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { db: 'up' };
  } catch (err) {
    // A short reason (e.g. ECONNREFUSED) is enough; the controller logs it.
    const reason = (err as { code?: string }).code ?? (err as Error).message;
    return { db: 'down', reason };
  }
}
