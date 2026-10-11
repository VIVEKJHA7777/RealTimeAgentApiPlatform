import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error.js';
import { isNotFound, isUniqueViolation } from '../lib/prisma-errors.js';

// The LAST stop for every error from every layer (route → controller → service → database).
// Nobody below catches errors just to hide them; they bubble up to here, where we:
//   1. turn the error into our standard JSON shape (what the caller sees)
//   2. log it, including the ORIGINAL error ("caused by: ...") (what we see)

// Turns any error into an AppError (status + code + safe message).
function toAppError(err: unknown): AppError {
  // 1. Errors we threw on purpose (may carry the original error as `cause`).
  if (err instanceof AppError) return err;

  // 2. A unique rule was broken and no service handled it more specifically.
  //    Usually a race: two requests tried to create the same thing at the same time.
  if (isUniqueViolation(err)) {
    return new AppError(409, 'CONFLICT', 'This already exists', { cause: err });
  }

  // 3. Update/delete of a row that doesn't exist (maybe deleted by another request).
  if (isNotFound(err)) {
    return new AppError(404, 'NOT_FOUND', 'Not found', { cause: err });
  }

  // 4. Errors from Express' JSON body parser carry a status and a type.
  if (typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number') {
    const type = 'type' in err ? err.type : undefined;
    if (type === 'entity.parse.failed') {
      // No `cause`: the parser's error carries the raw body, and its message quotes part of it,
      // which may hold a secret (a password, a pasted access key). The 400 says enough.
      return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
    }
    if (type === 'entity.too.large') {
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large', { cause: err });
    }
    if (err.status >= 400 && err.status < 500) {
      return new AppError(err.status, 'BAD_REQUEST', 'Bad request', { cause: err });
    }
  }

  // 5. Anything else is a bug on our side.
  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong', { cause: err });
}

// A short, readable list of every error under this one (cause → cause → ...).
// pino prints causes' messages and stacks, but NOT their other properties, and the most
// useful clue is often there: e.g. Prisma puts "ECONNREFUSED" (DB down) in `code`.
function describeCauses(err: AppError) {
  const causes: { type: string; code?: unknown; message: string }[] = [];
  let current: unknown = err.cause;
  while (current instanceof Error && causes.length < 5) {
    const lines = current.message.split('\n').map((line) => line.trim()).filter(Boolean);
    causes.push({
      type: current.name,
      code: (current as { code?: unknown }).code,
      // Prisma's message ends with the actual reason ("Unique constraint failed on ...").
      message: lines.at(-1) ?? '',
    });
    current = current.cause;
  }
  return causes;
}

// Express recognises an error handler by its 4 arguments (err, req, res, next).
// Any error thrown in a route/controller/service (sync or async, in Express 5) ends up here.
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    // Response already started; let Express close the connection.
    return next(err);
  }

  const appError = toAppError(err);

  // Log the AppError: pino prints its stack AND every `cause` underneath it,
  // so the log shows both "what we told the caller" and "what really happened".
  if (appError.status >= 500) {
    req.log.error({ causes: describeCauses(appError), err: appError }, `${appError.code}: unhandled error`);
  } else if (appError.cause !== undefined) {
    // A 4xx that wraps a lower-level error (e.g. a DB unique violation): worth one warn line.
    req.log.warn({ causes: describeCauses(appError), err: appError }, `${appError.code}: ${appError.message}`);
  }
  // Plain 4xx (validation, not found...) are already logged as a warn line by pino-http.

  // The caller only ever sees the safe part. Never `cause`, never a stack trace.
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details && { details: appError.details }),
      ...(appError.extra && { extra: appError.extra }),
      requestId: req.id,
    },
  });
}
