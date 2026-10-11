// SERVICE layer for an API's tokens (Phase 4, task 4.2): business rules + database.
//
// Rules (phase doc §3, P4-1/2/12/13/14/15/17):
//   - several tokens per API, each with a name unique among the API's not-revoked tokens (any case)
//   - at most 20 not-revoked tokens per API (expired ones count: Extend can make them active again)
//   - the token is returned when made (create / renew) and on "show"; lists only show the hint
//   - Extend = same token, new expiry · Renew = new token (same name), the old one revoked at once
//   - revoke is final: the readable copy is deleted (a DB rule enforces it), the row stays for history
//
// Two people acting at the same moment: every change first locks the API row (FOR UPDATE), so
// changes to one API's tokens happen one after the other and every check (name taken, limit,
// already revoked) sees the latest state. Same lock order as the design save (API row first).
import type { Api, ApiToken, AuthHeader, Prisma } from '../../../generated/prisma/client.js';
import { decryptToken, MAX_ACTIVE_TOKENS_PER_API, newApiToken, tokenState } from '../../../lib/api-token.js';
import { AppError } from '../../../lib/app-error.js';
import { prisma } from '../../../lib/prisma.js';
import { isNotFound } from '../../../lib/prisma-errors.js';
import type { CreateTokenInput, RenewTokenInput, UpdateTokenInput } from './tokens.schemas.js';

export type Tx = Prisma.TransactionClient;

// What the browser may see of a token. Never the token itself, nor its hash or encrypted copy.
function toTokenInfo(row: ApiToken, now = new Date()) {
  const state = tokenState(row, now);
  return {
    id: row.id,
    name: row.name,
    hint: row.hint, // "rtk_8Hf2"
    state, // active | expired | revoked
    // Can "Show" / "Copy" work? No for revoked tokens (copy deleted) and for copies made with
    // another TOKEN_ENCRYPTION_KEY (then: renew it). Decrypting ~20 tokens takes microseconds.
    canShow: row.tokenEncrypted !== null && decryptToken(row.tokenEncrypted, row.tokenHash) !== null,
    expiresAt: row.expiresAt, // null = never
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}
export type TokenInfo = ReturnType<typeof toTokenInfo>;

const tokenNotFound = () => new AppError(404, 'TOKEN_NOT_FOUND', 'Token not found');
const tokenRevoked = (row: ApiToken) =>
  new AppError(409, 'TOKEN_REVOKED', `"${row.name}" was revoked and can't be used, shown or changed. Make a new token instead.`);

// Runs `work` while holding the API row lock. The API may have been deleted after the request's
// middleware loaded it: then nothing is locked → 404 (the tokens went with it).
export async function withApiLock<T>(api: Api, work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM apis WHERE id = ${api.id} FOR UPDATE`;
    if (locked.length === 0) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
    return work(tx);
  });
}

async function findToken(tx: Tx, api: Api, tokenId: string) {
  // Scoped by API: another API's (or brand's) token id is simply "not found".
  const row = await tx.apiToken.findFirst({ where: { id: tokenId, apiId: api.id } });
  if (!row) throw tokenNotFound();
  return row;
}

async function checkNameFree(tx: Tx, api: Api, name: string, exceptId?: string) {
  const taken = await tx.apiToken.findFirst({
    where: { apiId: api.id, revokedAt: null, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (taken) {
    throw new AppError(409, 'TOKEN_NAME_TAKEN', `This API already has a token named "${name}". Choose another name.`, {
      details: [{ field: 'name', message: 'Already used by another token of this API' }],
    });
  }
}

// GET: every token of the API: not-revoked ones oldest first, then revoked ones newest first.
export async function listTokens(api: Api) {
  const rows = await prisma.apiToken.findMany({ where: { apiId: api.id }, orderBy: { createdAt: 'asc' } });
  const now = new Date();
  const live = rows.filter((r) => !r.revokedAt);
  const revoked = rows.filter((r) => r.revokedAt).sort((a, b) => b.revokedAt!.getTime() - a.revokedAt!.getTime());
  return {
    tokens: [...live, ...revoked].map((r) => toTokenInfo(r, now)),
    authHeader: headerStyle(api.authHeader),
    limits: { maxTokens: MAX_ACTIVE_TOKENS_PER_API },
  };
}

// POST: a new token. Returns it in full (the dialog shows it; it stays viewable later).
export async function createToken(api: Api, input: CreateTokenInput) {
  return withApiLock(api, async (tx) => {
    await checkNameFree(tx, api, input.name);
    const count = await tx.apiToken.count({ where: { apiId: api.id, revokedAt: null } });
    if (count >= MAX_ACTIVE_TOKENS_PER_API) {
      throw new AppError(
        409,
        'TOO_MANY_TOKENS',
        `An API can have at most ${MAX_ACTIVE_TOKENS_PER_API} tokens (expired ones count). Revoke one you don't use first.`,
      );
    }
    const made = newApiToken();
    const row = await tx.apiToken.create({
      data: { apiId: api.id, name: input.name, tokenHash: made.tokenHash, tokenEncrypted: made.tokenEncrypted, hint: made.hint, expiresAt: input.expiresAt },
    });
    return { token: made.token, tokenInfo: toTokenInfo(row) };
  });
}

// GET …/reveal: the full token, for the owner's Show / Copy. Read-only, no lock needed.
export async function revealToken(api: Api, tokenId: string) {
  const row = await prisma.apiToken.findFirst({ where: { id: tokenId, apiId: api.id } });
  if (!row) throw tokenNotFound();
  if (row.revokedAt || !row.tokenEncrypted) throw tokenRevoked(row);
  const token = decryptToken(row.tokenEncrypted, row.tokenHash);
  if (!token) {
    // Made with another TOKEN_ENCRYPTION_KEY (or the stored copy was changed). It still WORKS on
    // /v1 (calls are checked by hash); it just can't be shown. Renewing gives a new viewable one.
    throw new AppError(409, 'TOKEN_UNREADABLE', `"${row.name}" still works but can't be shown (it was saved with a different encryption key). Renew it to get a new token you can view.`);
  }
  return { token, tokenInfo: toTokenInfo(row) };
}

// PATCH: rename and / or Extend (new expiry, same token: nothing to change in Jivox).
export async function updateToken(api: Api, tokenId: string, input: UpdateTokenInput) {
  return withApiLock(api, async (tx) => {
    const row = await findToken(tx, api, tokenId);
    if (row.revokedAt) throw tokenRevoked(row);
    if (input.name !== undefined) await checkNameFree(tx, api, input.name, row.id);
    const updated = await tx.apiToken.update({
      where: { id: row.id },
      data: { name: input.name, expiresAt: input.expiresAt },
    });
    return { tokenInfo: toTokenInfo(updated) };
  });
}

// POST …/renew: a NEW token with the same name; the old one is revoked in the same transaction
// (Jivox agents linked to the old one move to the new one, task 5.5)
// (both happen or neither). Works on active and expired tokens. Two renews at once: the second
// waits for the lock, then finds the old token revoked → 409 TOKEN_REVOKED (only one new token).
export async function renewToken(api: Api, tokenId: string, input: RenewTokenInput) {
  return withApiLock(api, async (tx) => {
    const old = await findToken(tx, api, tokenId);
    if (old.revokedAt) throw tokenRevoked(old);
    const now = new Date();
    const revokedOld = await tx.apiToken.update({ where: { id: old.id }, data: { revokedAt: now, tokenEncrypted: null } });
    const made = newApiToken();
    const row = await tx.apiToken.create({
      data: { apiId: api.id, name: old.name, tokenHash: made.tokenHash, tokenEncrypted: made.tokenEncrypted, hint: made.hint, expiresAt: input.expiresAt },
    });
    // Jivox agents that used the old token follow the new one (Renew = "replace this token"; the
    // user pastes the new one in Studio). Same transaction: never an agent left on a revoked token.
    const moved = await tx.jivoxAgent.updateMany({ where: { apiId: api.id, tokenId: old.id }, data: { tokenId: row.id } });
    return { token: made.token, tokenInfo: toTokenInfo(row), replaced: toTokenInfo(revokedOld), agentsMoved: moved.count };
  });
}

// DELETE: revoke. Final: the readable copy is deleted. Revoking twice is fine (same answer):
// two people pressing Revoke at once both see "revoked", with the time of the first.
export async function revokeToken(api: Api, tokenId: string) {
  return withApiLock(api, async (tx) => {
    const row = await findToken(tx, api, tokenId);
    if (row.revokedAt) return { tokenInfo: toTokenInfo(row) };
    const updated = await tx.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), tokenEncrypted: null } });
    return { tokenInfo: toTokenInfo(updated) };
  });
}

// ── Header style (how Jivox sends the token) ──
// The DB enum can't hold a dash; the API speaks the header's name.
export function headerStyle(value: AuthHeader): 'x-api-key' | 'bearer' {
  return value === 'bearer' ? 'bearer' : 'x-api-key';
}

// PUT /auth-header. Takes effect on the next /v1 call (only the chosen style is accepted there).
export async function setAuthHeader(api: Api, style: 'x-api-key' | 'bearer') {
  const updated = await prisma.api
    .update({ where: { id: api.id }, data: { authHeader: style === 'bearer' ? 'bearer' : 'x_api_key' }, select: { authHeader: true } })
    .catch((err: unknown) => {
      if (isNotFound(err)) return null; // deleted meanwhile
      throw err;
    });
  if (!updated) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
  return { authHeader: headerStyle(updated.authHeader) };
}
