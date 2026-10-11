import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error.js';

// Put this on any route that needs a logged-in user. Relies on loadSession having run.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'You must be logged in');
  }
  next();
}
