import type { NextFunction, Request, Response } from 'express';
import * as authService from '../modules/auth/auth.service.js';
import { SESSION_COOKIE_NAME, clearSessionCookie } from '../lib/session.js';

// Runs on EVERY request. If the request carries a valid session cookie, it fills in
// req.user and req.sessionId. It never blocks a request; requireAuth does that.
//
// Concurrency: nothing is stored in a shared variable. Each request reads its own cookie,
// so 100 users at the same time each get their own req.user.
export async function loadSession(req: Request, res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof token !== 'string' || token === '') {
    return next(); // no cookie → anonymous request
  }

  const found = await authService.findSessionByToken(token);
  if (!found) {
    // Unknown, revoked or expired token: tell the browser to drop the useless cookie.
    clearSessionCookie(res);
    return next();
  }

  req.user = found.user;
  req.sessionId = found.sessionId;
  next();
}
