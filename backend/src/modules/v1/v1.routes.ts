// ROUTES for the live API, mounted at /v1 BEFORE cookies / sessions (P4-7): server-to-server
// only, no cookies, no sessions, no CORS. Has its own JSON parser and error handler so EVERY
// answer, including invalid JSON, too-large bodies, unknown paths and crashes, is a contract
// envelope with Cache-Control: no-store (P4-6).
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { sendFailure, sendV1, V1Error } from './envelope.js';
import { callNote, keepBody, recordCalls } from './recent-calls.js';
import { newSwitchState } from './test-switches.js';
import { answerCall } from './v1.service.js';

export const v1Router = Router();

// Any content type is read as JSON: callers don't always send "application/json". GET bodies
// are ignored. 1 MB is far more than 100 ids need.
// Recent calls (task 4.8b): notes each /v1/<brand>/<api> call; the parser keeps the body's start.
v1Router.use(recordCalls);
v1Router.use(express.json({ limit: '1mb', type: () => true, verify: (_req, res, buf) => keepBody(res as Response, buf) }));

v1Router.all('/:brandSlug/:apiSlug', async (req: Request, res: Response) => {
  // The test switches of this call (7.4), also read by sendV1 on failures and by the call log.
  const switches = (res.locals.v1Switches = newSwitchState());
  const response = await answerCall(req, String(req.params.brandSlug), String(req.params.apiSlug), callNote(res), switches);
  sendV1(res, 200, response);
});

// Anything else under /v1 (e.g. /v1/brand-only).
v1Router.use(() => {
  throw new V1Error(404, 'NOT_FOUND', 'Not found. Call /v1/<brand>/<api>.');
});

// Errors → envelope. Ours (V1Error), the JSON parser's (invalid / too large), and real bugs.
v1Router.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof V1Error) return sendFailure(res, err);
  const type = typeof err === 'object' && err !== null && 'type' in err ? err.type : undefined;
  if (type === 'entity.parse.failed') return sendFailure(res, new V1Error(400, 'BAD_REQUEST', 'The body is not valid JSON.'));
  if (type === 'entity.too.large') return sendFailure(res, new V1Error(413, 'PAYLOAD_TOO_LARGE', 'The body is too large (at most 1 MB).'));
  // Too many calls at once (no free database connection within 3 s) or the database briefly
  // unreachable: say "busy, try again" (503 + Retry-After) instead of a 500.
  if (isBusy(err)) {
    req.log.warn({ err: describe(err) }, 'v1: busy (no database connection)');
    return sendFailure(res, new V1Error(503, 'SERVICE_BUSY', 'The API is busy right now. Try again in a moment.', { 'Retry-After': '1' }));
  }
  req.log.error({ err }, 'v1: unexpected error');
  sendFailure(res, new V1Error(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Try again.'));
});

// The error, or anything it wraps, says "no connection": pool wait timed out, refused, reset.
const BUSY = /timeout exceeded when trying to connect|ECONNREFUSED|ECONNRESET|Connection terminated|too many clients/i;
function isBusy(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 6; depth++) {
    const text = e instanceof Error ? `${e.message} ${(e as { code?: unknown }).code ?? ''}` : String(e);
    if (BUSY.test(text)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
const describe = (err: unknown) => (err instanceof Error ? err.message.split('\n').filter(Boolean).at(-1) : String(err));
