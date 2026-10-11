// What the browser may send to "Try it" and the self-check (task 4.5).
import { z } from 'zod';

// ids left out = the first 2 rows of the data (like the contract's Sample A). More than the
// design's maxIdsPerCall is allowed here on purpose: Try it then shows the 400 /v1 would give.
export const testInputSchema = z.object({
  ids: z
    .array(z.string().trim().min(1, 'An id is empty').max(500, 'An id can be at most 500 characters'))
    .min(1, 'Send at least one id, or leave ids out for 2 real ones')
    .max(100, 'At most 100 ids')
    .optional(),
});
export type TestInput = z.infer<typeof testInputSchema>;
