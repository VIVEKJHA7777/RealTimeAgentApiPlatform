// CONTROLLER layer: the HTTP side. Reads the request, calls the service, writes the response.
// No business rules and no database here. Errors are NOT caught: they bubble up to the error handler.
import type { Request, Response } from 'express';
import { clearSessionCookie, setSessionCookie } from '../../lib/session.js';
import { validate } from '../../lib/validate.js';
import { loginSchema, signupSchema } from './auth.schemas.js';
import * as authService from './auth.service.js';

// POST /api/auth/signup  { email, password, name? }
// → 201 { user } + Set-Cookie: sid=...   (the new user is logged in right away)
export async function signup(req: Request, res: Response) {
  const input = validate(signupSchema, req.body); // 1. check input   (400 if bad)
  const { user, token, expiresAt } = await authService.signup(input); // 2. do the work (409 if taken)
  setSessionCookie(res, token, expiresAt); // 3. HTTP details: cookie...
  res.status(201).json({ user }); //            ...status + body
}

// POST /api/auth/login  { email, password }
// → 200 { user } + Set-Cookie: sid=<new token>   |   401 INVALID_CREDENTIALS
export async function login(req: Request, res: Response) {
  const input = validate(loginSchema, req.body);
  const { user, token, expiresAt } = await authService.login(input);

  // Logging in again in the same browser: the old cookie is about to be replaced,
  // so delete its session instead of leaving it valid in the DB for 7 more days.
  if (req.sessionId) {
    await authService.logout(req.sessionId);
  }

  setSessionCookie(res, token, expiresAt);
  res.json({ user });
}

// POST /api/auth/logout   (requireAuth)
// → 204 No Content; the session row is deleted and the browser is told to drop the cookie.
export async function logout(req: Request, res: Response) {
  await authService.logout(req.sessionId!); // `!`: requireAuth guarantees it is set
  clearSessionCookie(res);
  res.status(204).end();
}

// GET /api/auth/me   (requireAuth)
// → 200 { user }: "who am I?" The frontend calls this on page load.
export function me(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store'); // personal data: browsers/proxies must not cache it
  res.json({ user: req.user });
}
