import type { z } from 'zod';
import { AppError } from './app-error.js';

// Checks `data` (usually req.body) against a Zod schema.
// - valid   → returns the parsed data, fully typed (and trimmed/lower-cased if the schema says so)
// - invalid → throws a 400 AppError listing every bad field
//
// Usage inside a controller:  const input = validate(signupSchema, req.body);
export function validate<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
      details: result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
    });
  }
  return result.data;
}
