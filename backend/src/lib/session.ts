// Everything about login sessions in one place: tokens, hashing, cookie settings.
import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { env } from '../config/env.js';

export const SESSION_COOKIE_NAME = 'sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// 32 random bytes = 256 bits: impossible to guess. base64url = safe in a cookie (no + / =).
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

// We store only this hash in the DB. If the DB leaks, the hashes can't be used as cookies.
// SHA-256 (fast) is fine here because the token is already long and random;
// slow hashing (argon2) is only needed for human-chosen passwords.
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

// Ask the browser to store the token.
export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true, // page JavaScript can't read it → XSS can't steal it
    sameSite: 'lax', // not sent on cross-site POSTs → basic CSRF protection
    secure: env.NODE_ENV === 'production', // HTTPS only in production (localhost is http)
    path: '/', // sent with every request to our site
    expires: expiresAt, // browser deletes it at the same time the DB session expires
  });
}

// Ask the browser to delete the cookie (used by logout in task 1.4).
// The options must match the ones used when setting it, or the browser keeps it.
export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
  });
}
