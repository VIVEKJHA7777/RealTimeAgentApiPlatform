// What the browser may send for an API's tokens (Phase 4, task 4.2). Zod = one place for the rules.
import { z } from 'zod';
import { TOKEN_NAME_MAX } from '../../../lib/api-token.js';

// The furthest expiry we accept. "Never" (null) is the way to say "no end".
export const MAX_EXPIRY_YEARS = 10;

const name = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(TOKEN_NAME_MAX, `Name can be at most ${TOKEN_NAME_MAX} characters`);

// null = never expires. A date must be in the future and at most 10 years away.
// The browser turns "30 days" / "pick a date" (end of that day, the user's time zone) into an
// exact moment; the server only checks it.
const expiresAt = z
  .iso.datetime({ offset: true, error: 'Expiry must be a date and time (ISO 8601) or null for never' })
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() > Date.now(), 'Expiry must be in the future')
  .refine(
    (d) => d.getTime() <= Date.now() + MAX_EXPIRY_YEARS * 366 * 24 * 3600 * 1000,
    `Expiry can be at most ${MAX_EXPIRY_YEARS} years away (choose "Never" instead)`,
  )
  .nullable();

// POST /tokens: a new token. Expiry left out = never (the default in the dialog).
export const createTokenSchema = z.object({ name, expiresAt: expiresAt.default(null) });

// PATCH /tokens/:tokenId: rename and / or Extend (new expiry, same token).
export const updateTokenSchema = z
  .object({ name: name.optional(), expiresAt: expiresAt.optional() })
  .refine((v) => v.name !== undefined || v.expiresAt !== undefined, 'Send a name or an expiry to change');

// POST /tokens/:tokenId/renew: a new token in place of this one (same name).
export const renewTokenSchema = z.object({ expiresAt: expiresAt.default(null) });

// PUT /auth-header: how Jivox sends the token.
export const AUTH_HEADER_STYLES = ['x-api-key', 'bearer'] as const;
export const authHeaderSchema = z.object({
  style: z.enum(AUTH_HEADER_STYLES, 'Style must be "x-api-key" or "bearer"'),
});

export type CreateTokenInput = z.infer<typeof createTokenSchema>;
export type UpdateTokenInput = z.infer<typeof updateTokenSchema>;
export type RenewTokenInput = z.infer<typeof renewTokenSchema>;
