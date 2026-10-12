// What the browser may ask of an API's call log (Phase 7, task 7.3).
import { z } from 'zod';

const cursor = z.string().regex(/^\d{1,19}$/, 'must be a log entry id');
const when = z.iso.datetime({ offset: true, error: 'must be a date-time like 2026-10-12T09:30:00Z' });

export const logsQuery = z
  .object({
    // ok = HTTP 2xx with a success envelope · failed = anything else (also "the caller hung up") · or one code
    status: z.union([z.enum(['ok', 'failed']), z.coerce.number().int().min(100).max(599)]).optional(),
    // one of this API's tokens (= one agent), or none = calls without a usable token of this API
    token: z.union([z.literal('none'), z.string().min(1).max(64)]).optional(),
    switched: z.enum(['yes', 'no']).optional(), // changed by a test switch (7.4) or not
    check: z.enum(['passed', 'failed']).optional(), // the request check (7.2)
    id: z.string().trim().min(1).max(100).optional(), // calls that asked for this id (exact)
    kind: z.enum(['call', 'switch']).optional(), // left out = both
    from: when.optional(),
    to: when.optional(),
    before: cursor.optional(), // older than this entry (next page)
    after: cursor.optional(), // newer than this entry (the live list asks "anything new?")
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((q) => !(q.before && q.after), { message: 'Use before OR after, not both', path: ['after'] });
export type LogsQuery = z.infer<typeof logsQuery>;

export const logIdParam = cursor;
