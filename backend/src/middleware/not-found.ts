import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error.js';

// Runs only when no route matched the request.
// Hands a 404 AppError to the error handler, so every error has the same JSON shape.
export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}
