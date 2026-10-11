import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../lib/app-error.js';

// Uploaded files are written straight to a temp folder on disk while they arrive
// (never held in memory), so a 200 MB file uses almost no RAM.
export const UPLOAD_DIR = env.UPLOAD_TMP_DIR ?? path.join(os.tmpdir(), 'api-platform-uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // A random name: the user's file name is never used as a path (no "../../" tricks),
    // and two uploads at the same moment can't overwrite each other.
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`),
  }),
  limits: {
    fileSize: env.UPLOAD_MAX_MB * 1024 * 1024,
    files: 1,
    fields: 20,
    fieldSize: 10 * 1024, // text fields (name, idColumn...) are small
  },
  // multer 2: decode the original file name as UTF-8 ("prodüct.csv" stays readable).
  defParamCharset: 'utf8',
}).single('file');

// Middleware: accepts one file in the multipart field "file" → req.file (path on disk).
// Turns multer's errors into our AppErrors. Put it AFTER requireAuth / requireOrganization,
// so strangers can't make us write 200 MB to disk.
export function uploadFile(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(413, 'FILE_TOO_LARGE', `File is too large (max ${env.UPLOAD_MAX_MB} MB)`, {
            cause: err,
          }),
        );
      }
      return next(
        new AppError(400, 'UPLOAD_INVALID', 'Send exactly one file, in a field named "file"', {
          cause: err,
        }),
      );
    }
    // The browser stopped sending (user left the page, cancelled, lost the connection).
    // A normal event, not a bug: nobody receives this answer, but the log shows one warning
    // instead of an "unhandled error". (multer has already deleted the partial file.)
    if (req.destroyed || (err instanceof Error && err.message === 'Request aborted')) {
      return next(new AppError(400, 'UPLOAD_CANCELLED', 'The upload was cancelled', { cause: err }));
    }
    next(err); // anything else: let the error handler log it as a real problem
  });
}

// Deletes an uploaded temp file. Never throws (a missing file is fine).
export async function removeUploadedFile(file: Express.Multer.File | undefined) {
  if (file) await rm(file.path, { force: true });
}
