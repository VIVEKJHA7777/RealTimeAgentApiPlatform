// Everything about API tokens (the secrets Jivox sends to /v1) in one place:
// making them, hashing them for the per-call check, and encrypting the copy the owner can view.
import { createHash, randomBytes } from 'node:crypto';
import { openSecret, sealSecret } from './secret-box.js';

export const TOKEN_PREFIX = 'rtk_';
// rtk_ + 32 random bytes in base64url (43 characters): impossible to guess.
export const TOKEN_PATTERN = /^rtk_[A-Za-z0-9_-]{43}$/;
export const TOKEN_NAME_MAX = 60;
export const MAX_ACTIVE_TOKENS_PER_API = 20;

export function generateApiToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

// What /v1 looks up. SHA-256 (fast) is enough: the token is long and random (see lib/session.ts).
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// "rtk_8Hf2": shown in lists so tokens can be told apart without revealing them.
export function tokenHint(token: string): string {
  return token.slice(0, 8);
}

// ── Encrypted copy (lib/secret-box.ts, AES-256-GCM) ──
// The token's own hash is bound in: a copy moved to another row (another token or API) can't be
// decrypted there.
export function encryptToken(token: string, tokenHash: string): string {
  return sealSecret(token, tokenHash);
}

// The token, or null if it can't be read (another TOKEN_ENCRYPTION_KEY, changed in the DB, another
// row's). Never throws (the caller says "can't be shown, renew it").
export function decryptToken(stored: string, tokenHash: string): string | null {
  const token = openSecret(stored, tokenHash);
  // Belt and braces: the copy must be the token this row's hash is of.
  return token !== null && hashApiToken(token) === tokenHash ? token : null;
}

// Everything the DB needs for a new token, plus the token itself (to show once in the response).
export function newApiToken() {
  const token = generateApiToken();
  const tokenHash = hashApiToken(token);
  return { token, tokenHash, hint: tokenHint(token), tokenEncrypted: encryptToken(token, tokenHash) };
}

// Active = can be used on /v1 right now.
export type TokenState = 'active' | 'expired' | 'revoked';
export function tokenState(t: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): TokenState {
  if (t.revokedAt) return 'revoked';
  if (t.expiresAt && t.expiresAt <= now) return 'expired';
  return 'active';
}
