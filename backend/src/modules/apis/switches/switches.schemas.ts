// What the browser may send to turn a test switch on or change it (Phase 7, task 7.4).
import { z } from 'zod';
import { HTTP_STATUSES, SLOW_DEFAULT_MS, SWITCH_KINDS } from '../../v1/test-switches.js';

export const switchKindParam = z.enum(SWITCH_KINDS, `Unknown switch. One of: ${SWITCH_KINDS.join(', ')}`);

export const setSwitchSchema = z.object({
  // Per kind (checked in the service, the kind comes from the URL): wrong_type { field }, slow { ms },
  // http_status { status }; the others take none.
  options: z.record(z.string(), z.unknown()).default({}),
  tokenId: z.string().min(1).max(64).nullable().default(null), // null = every caller of the API (P7-1)
  minutes: z.int('minutes must be a whole number').min(1, 'At least 1 minute').max(1440, 'At most 24 hours (1 440 minutes)').default(60), // P7-2
  applyToOwnChecks: z.boolean().default(false), // P7-3
});
export type SetSwitchInput = z.infer<typeof setSwitchSchema>;

export const optionsFor = {
  wrong_type: z.object({ field: z.string('Choose the field to send with the wrong type').min(1).max(64) }).strict(),
  slow: z.object({ ms: z.int('ms must be a whole number').min(1, 'At least 1 ms').max(30_000, 'At most 30 000 ms').default(SLOW_DEFAULT_MS) }).strict(),
  http_status: z
    .object({ status: z.union(HTTP_STATUSES.map((s) => z.literal(s)), `status must be one of ${HTTP_STATUSES.join(', ')}`).default(500) })
    .strict(),
} as const;
export const noOptions = z.strictObject({}, 'This switch takes no options');
