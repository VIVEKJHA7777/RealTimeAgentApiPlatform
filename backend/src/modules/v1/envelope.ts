// The contract/1 envelope for /v1 FAILURES. Every /v1 answer, also 401 / 404 / 400 / 500, uses
// the same shape as a success, so Jivox reads failures the same way (P4-6):
//   { "status": "failure", "generated_at": "…", "data": [],
//     "errors": [ { "error_id": "", "error_code": "UNAUTHORIZED", "error_message": "…" } ] }
// Successes are built by design/build-response.ts (buildResponse).
import type { Response } from 'express';
import { dropsNoStore, sendsNotJson, slowMs, NOT_JSON_TEXT, type SwitchState } from './test-switches.js';

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
  | 'INTERNAL_ERROR'
  | 'FORBIDDEN' // only from the HTTP status test switch (7.4), like the next two
  | 'RATE_LIMITED'
  | 'BAD_GATEWAY';

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

// EVERY /v1 answer goes out here (7.2). Written directly instead of res.json(), which adds an
// ETag (nothing should cache this answer) and would answer a matching If-None-Match with an EMPTY
// 304. The exact text sent is kept for the call log. The sending test switches (7.4) act here:
// slow (waits first), no_store (no Cache-Control), not_json (plain text).
export function sendV1(res: Response, status: number, body: unknown) {
  const switches = res.locals.v1Switches as SwitchState | undefined;
  // In the fixed order (test-switches.ts), so the call log lists them that way.
  const wait = slowMs(switches);
  const noStore = dropsNoStore(switches);
  const notJson = sendsNotJson(switches);
  const text = notJson ? NOT_JSON_TEXT : JSON.stringify(body);
  setV1Headers(res);
  if (notJson) res.type('text/plain');
  if (noStore) res.removeHeader('Cache-Control');
  res.locals.v1Body = notJson ? undefined : body; // status + error codes for the call log
  res.locals.v1Sent = text;
  const send = () => {
    if (!res.writableEnded && !res.destroyed) res.status(status).set('Content-Length', String(Buffer.byteLength(text))).end(text);
  };
  if (wait > 0) setTimeout(send, wait);
  else send();
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
  res.set(error.headers);
  res.locals.v1Failure = { code: error.code, message: error.message }; // for Recent calls (task 4.8b)
  sendV1(res, error.status, failureBody(error));
}
