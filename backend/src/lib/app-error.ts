// An error we throw on purpose, carrying everything needed for the HTTP response.
// Example: throw new AppError(409, 'SLUG_TAKEN', 'This slug is already in use')
// The error handler turns it into: 409 { "error": { "code": "SLUG_TAKEN", "message": "..." } }
//
// When we turn a lower-level error into an AppError, ALWAYS pass it as `cause`:
//   throw new AppError(409, 'EMAIL_TAKEN', '...', { cause: err })
// The caller only sees our friendly message; the logs show the original error too
// ("caused by: ..."), so we can always find the real problem.

export type ErrorDetail = { field: string; message: string };

type AppErrorOptions = {
  details?: ErrorDetail[]; // per-field problems, e.g. from validation
  cause?: unknown; // the original error we are wrapping
  // More facts for the screen (sent as error.extra), e.g. which Jivox agents a design change hits.
  extra?: Record<string, unknown>;
};

export class AppError extends Error {
  public readonly details?: ErrorDetail[];
  public readonly extra?: Record<string, unknown>;

  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    options: AppErrorOptions = {},
  ) {
    // `cause` is a standard Error feature (ES2022): new Error(msg, { cause })
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.details = options.details;
    this.extra = options.extra;
  }
}
