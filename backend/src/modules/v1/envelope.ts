// The contract/1 envelope for /v1 FAILURES. Every /v1 answer, also 401 / 404 / 400 / 500, uses
// the same shape as a success, so Jivox reads failures the same way (P4-6):
//   { "status": "failure", "generated_at": "…", "data": [],
//     "errors": [ { "error_id": "", "error_code": "UNAUTHORIZED", "error_message": "…" } ] }
// Successes are built by design/build-response.ts (buildResponse).
import type { Response } from 'express';

export type V1ErrorCode =
  | 'UNAUTHORIZED' // no token / unknown / revoked / another API's / wrong header
  | 'TOKEN_EXPIRED'
  | 'NOT_FOUND' // the API isn't published (or the path matches nothing)
  | 'METHOD_NOT_ALLOWED'
  | 'BAD_REQUEST' // no ids, wrong body shape, invalid JSON
  | 'TOO_MANY_IDS'
  | 'PAYLOAD_TOO_LARGE'
  | 'NO_DATA'
  | 'SERVICE_BUSY' // overloaded / database briefly unreachable: try again
  | 'INTERNAL_ERROR';

// Thrown inside the /v1 handler; turned into an envelope by v1ErrorHandler.
export class V1Error extends Error {
  constructor(
    public readonly status: number,
    public readonly code: V1ErrorCode,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'V1Error';
  }
}

export function generatedAt(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z'); // same format as buildResponse
}

// Headers on EVERY /v1 answer: never cached (Jivox checks no-store), JSON.
export function setV1Headers(res: Response) {
  res.set('Cache-Control', 'no-store');
  res.type('application/json');
}

// The failure envelope's body (also shown by "Try it" for a call that would fail).
export function failureBody(error: V1Error) {
  return {
    status: 'failure' as const,
    generated_at: generatedAt(),
    data: [] as never[],
    errors: [{ error_id: '', error_code: error.code, error_message: error.message }],
  };
}

export function sendFailure(res: Response, error: V1Error) {
  setV1Headers(res);
  res.set(error.headers);
  res.locals.v1Failure = { code: error.code, message: error.message }; // for Recent calls (task 4.8b)
  res.status(error.status).json(failureBody(error));
}
