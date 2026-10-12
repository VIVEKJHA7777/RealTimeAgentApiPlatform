// Storage of the call log (Phase 7, task 7.1): batches in, the newest CALL_LOG_KEPT per API kept.
// Who fills it (after each /v1 answer) is task 7.2; this file only writes and trims.
//
// Trimming: one statement per API that was just written to, using the (api_id, id DESC) index:
// "delete this API's rows older than its 500th newest". Bigger id = newer (BIGSERIAL), so no clock
// is involved and two writers can't confuse the order.
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';

export const CALL_LOG_KEPT = 500;

export type CallLogRow = Prisma.ApiCallLogCreateManyInput;

// Writes one batch (any APIs mixed), then trims each API it touched. Returns how many were written.
export async function writeCallLogs(rows: CallLogRow[], keep = CALL_LOG_KEPT) {
  if (rows.length === 0) return 0;
  const { count } = await prisma.apiCallLog.createMany({ data: rows });
  for (const apiId of new Set(rows.map((r) => r.apiId))) await trimCallLogs(apiId, keep);
  return count;
}

export async function trimCallLogs(apiId: string, keep = CALL_LOG_KEPT) {
  return prisma.$executeRaw`
    DELETE FROM api_call_logs
    WHERE api_id = ${apiId}
      AND id < (SELECT id FROM api_call_logs WHERE api_id = ${apiId} ORDER BY id DESC OFFSET ${keep - 1} LIMIT 1)`;
}
