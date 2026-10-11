// Login + sign-up attempts per IP (task 6.0): AUTH_ATTEMPTS_PER_15_MIN, 0 = off (development).
// On a public server this stops password guessing, and keeps argon2 hashing from eating the
// small free CPU. Behind a proxy, req.ip is the caller only with TRUST_PROXY set (app.ts).
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/app-error.js';
import { createRateLimiter } from '../lib/rate-limit.js';

const WINDOW_MS = 15 * 60 * 1000;
const limiter = env.AUTH_ATTEMPTS_PER_15_MIN > 0 ? createRateLimiter(env.AUTH_ATTEMPTS_PER_15_MIN, WINDOW_MS) : null;

export function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const wait = limiter?.hit(req.ip ?? 'unknown');
  if (!wait) return next();
  res.set('Retry-After', String(wait));
  next(new AppError(429, 'TOO_MANY_ATTEMPTS', `Too many login or sign-up attempts from here. Try again in ${Math.ceil(wait / 60)} min.`));
}
