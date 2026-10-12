// The call log (Phase 7, task 7.2): every /v1 call, written AFTER the answer went out.
//
//   1. recent-calls.ts already keeps a "note" per call (token, ids, body…) and turns it into a
//      Recent call when the answer has gone out; at that moment it also calls logCall() here.
//   2. logCall builds the full entry: the request (query, body ≤ 4 KB, headers WITHOUT secrets,
//      ids, _meta, the request check), our answer (status, headers AS SENT, body ≤ 4 KB, ms) and
//      the caller, and puts it in a queue in memory. Nothing here touches the database.
//   3. The queue is written every 0.5 s in batches (call-log-store.ts: one insert + one trim per
//      API, so the newest 500 per API stay).
// If the database is unreachable the entries wait (at most 5 000, the oldest go first) and are
// retried every 2 s. Entries of an API deleted meanwhile, or that break a table rule (a bug),
// are dropped one by one instead of blocking the rest. Never stored: token headers, cookies,
// token-shaped text (scrubbed from path, query, bodies, header values).
import type { Request, Response } from 'express';
import { logger, scrubTokens } from '../../lib/logger.js';
import { CALL_LOG_KEPT, writeCallLogs, type CallLogRow } from './call-log-store.js';
import type { CallNote } from './recent-calls.js';
import { checkCall } from './request-check.js';
import type { SwitchState } from './test-switches.js';
import { SELF_CHECK_HEADER } from './v1.service.js';

const FLUSH_EVERY_MS = 500;
const RETRY_MS = 2_000;
const BATCH = 250;
const MAX_WAITING = 5_000;
const MAX_BODY = 4_096;
const MAX_PATH = 2_048;
const MAX_VALUE = 500; // one header / query value
const MAX_KEYS = 50; // headers / query parameters kept
const MAX_JSON_BYTES = 7_000; // the table allows 8 KB (Postgres' jsonb text adds a little)
const MAX_IDS = 100;

// Never stored, whatever the case (the table refuses the first four as well).
const SECRET_HEADERS = new Set(['authorization', 'x-api-key', 'cookie', 'set-cookie', 'proxy-authorization', SELF_CHECK_HEADER.name]);

// Scrub BEFORE cutting (a token starting inside the kept part is whole in the extra 64).
const cut = (text: string, max: number) => scrubTokens(text.slice(0, max + 64)).slice(0, max);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

// A flat record of texts that fits the table: at most 50 keys, 500 characters each, 7 KB.
function fitRecord(entries: [string, unknown][]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let left = 0;
  for (const [key, value] of entries) {
    const text = (v: unknown) => cut(typeof v === 'string' ? v : (JSON.stringify(v) ?? ''), MAX_VALUE);
    const kept = Array.isArray(value) ? value.slice(0, 20).map(text) : text(value);
    const next = { ...out, [cut(key, 100)]: kept };
    if (Object.keys(out).length >= MAX_KEYS || bytes(next) > MAX_JSON_BYTES - 100) left++;
    else Object.assign(out, next);
  }
  if (left > 0) out['…'] = `${left} more left out`;
  return out;
}

function requestHeaders(req: Request) {
  return fitRecord(Object.entries(req.headers).filter(([name]) => !SECRET_HEADERS.has(name.toLowerCase())));
}

// What WE sent: the headers as they went out (Node adds only Date / Connection / Keep-Alive).
function responseHeaders(res: Response) {
  if (!res.headersSent) return null;
  return fitRecord(Object.entries(res.getHeaders()).filter(([name]) => name.toLowerCase() !== 'set-cookie'));
}

// The request check must fit as well: name fewer rows, then fewer items.
function fitCheck<T extends { items: { missingFor?: string[] }[] }>(check: T): T & { cutShort?: true } {
  let fitted: T & { cutShort?: true } = check;
  while (bytes(fitted) > MAX_JSON_BYTES) {
    const named = fitted.items.some((i) => (i.missingFor?.length ?? 0) > 1);
    fitted = {
      ...fitted,
      items: named ? fitted.items.map((i) => (i.missingFor ? { ...i, missingFor: i.missingFor.slice(0, 1) } : i)) : fitted.items.slice(0, -1),
      cutShort: true,
    };
  }
  return fitted;
}

type Sent = { status?: unknown; errors?: { error_code?: unknown }[] };

export function buildCallLogRow(req: Request, res: Response, note: CallNote, apiId: string): CallLogRow {
  const sentBody = res.locals.v1Body as Sent | undefined;
  const sentText = res.locals.v1Sent as string | undefined;
  const query = req.query as Record<string, unknown>;
  let requestCheck = null;
  let meta = null;
  if (note.template) {
    const { check, meta: values } = checkCall(note.template.request, note.template.summary, req.method, query, req.body);
    requestCheck = fitCheck(check);
    meta = values;
  }
  const errorCodes = [...new Set((sentBody?.errors ?? []).map((e) => String(e?.error_code ?? '')).filter(Boolean))];
  return {
    apiId,
    kind: 'call',
    at: note.at,
    method: req.method.slice(0, 20),
    path: cut(req.originalUrl, MAX_PATH),
    query: Object.keys(query).length > 0 ? fitRecord(Object.entries(query)) : undefined,
    body: note.body ? note.body.slice(0, MAX_BODY) : null,
    bodyBytes: note.bodyBytes,
    requestHeaders: requestHeaders(req),
    tokenKind: note.tokenKind,
    tokenName: note.tokenKind === 'this_api' ? (note.tokenName?.slice(0, 100) ?? null) : null,
    tokenId: note.tokenKind === 'this_api' ? (note.tokenId ?? null) : null,
    header: note.header,
    ids: (note.ids ?? []).slice(0, MAX_IDS).map((id) => cut(id, 100)),
    idCount: note.ids?.length ?? null,
    meta: meta ?? undefined,
    requestCheck: requestCheck ?? undefined,
    status: res.writableFinished ? res.statusCode : null,
    envelopeStatus: typeof sentBody?.status === 'string' ? sentBody.status.slice(0, 20) : null,
    errorCodes: errorCodes.slice(0, 20).map((c) => c.slice(0, 50)),
    found: note.found ?? null,
    responseHeaders: responseHeaders(res) ?? undefined,
    responseBody: sentText !== undefined ? cut(sentText, MAX_BODY) : null,
    durationMs: Math.round(Number(process.hrtime.bigint() - note.started) / 1e5) / 10,
    switches: (res.locals.v1Switches as SwitchState | undefined)?.applied ?? [], // the test switches that changed this answer (7.4)
    ip: req.ip?.slice(0, 100) ?? null,
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
  };
}

// ── The queue ──
// The writer is swappable for tests only (phase-07-task-7.2-queue-lib.test.mts: database away, bad rows).
let write = writeCallLogs;
export function useCallLogWriter(writer: typeof writeCallLogs) {
  write = writer;
}
export const callLogWaiting = () => queue.length;

let queue: CallLogRow[] = [];
let timer: NodeJS.Timeout | undefined;
let flushing: Promise<void> | undefined;
let dropped = 0; // left out because the queue was full (the database was away too long)

// Called by recent-calls.ts once the answer has gone out. Never throws.
export function logCall(req: Request, res: Response, note: CallNote, apiId: string) {
  try {
    if (note.at <= (cleared.get(apiId)?.upTo ?? 0)) return; // arrived before a Clear, finished after it
    if (queue.length >= MAX_WAITING) {
      queue.shift();
      dropped++;
    }
    queue.push(buildCallLogRow(req, res, note, apiId));
    schedule(FLUSH_EVERY_MS);
  } catch (err) {
    logger.warn({ err }, 'Could not log a /v1 call');
  }
}

function schedule(ms: number) {
  if (timer || flushing || queue.length === 0) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flush();
  }, ms);
}

// The database is away (or busy): keep the entries and try again later.
const UNREACHABLE = /timeout exceeded when trying to connect|ECONNREFUSED|ECONNRESET|ETIMEDOUT|Connection terminated|too many clients|Can't reach database|P1001|P1017|P2024/i;
const unreachable = (err: unknown) => UNREACHABLE.test(`${String(err)} ${(err as { code?: unknown })?.code ?? ''}`);

async function flush(): Promise<void> {
  if (flushing) return flushing;
  let retry = false;
  flushing = (async () => {
    while (queue.length > 0) {
      const batch = queue.splice(0, BATCH);
      try {
        await write(batch, CALL_LOG_KEPT);
      } catch (err) {
        if (unreachable(err)) {
          queue = [...batch, ...queue];
          if (queue.length > MAX_WAITING) dropped += queue.splice(0, queue.length - MAX_WAITING).length;
          logger.warn({ err: describe(err), waiting: queue.length }, 'Call log: database unreachable; will retry');
          retry = true;
          return;
        }
        // A deleted API or a bad entry: don't let it block the others.
        if (!(await oneByOne(batch))) {
          retry = true;
          return;
        }
      }
    }
    if (dropped > 0) {
      logger.warn({ dropped }, 'Call log: some /v1 calls were not logged (the database was unreachable too long)');
      dropped = 0;
    }
  })();
  try {
    await flushing;
  } finally {
    flushing = undefined;
  }
  schedule(retry ? RETRY_MS : FLUSH_EVERY_MS);
}

// false = the database went away meanwhile (the rest waits in the queue again).
async function oneByOne(batch: CallLogRow[]) {
  for (const [i, row] of batch.entries()) {
    try {
      await write([row], CALL_LOG_KEPT);
    } catch (err) {
      if (unreachable(err)) {
        queue = [...batch.slice(i), ...queue];
        return false;
      }
      // 23503 = the API was deleted meanwhile (its log went with it): nothing to keep.
      if (!/23503|P2003|foreign key/i.test(String(err))) logger.error({ err: describe(err), apiId: row.apiId }, 'Call log: an entry was refused by the table and dropped');
    }
  }
  return true;
}

const describe = (err: unknown) => (err instanceof Error ? err.message.split('\n').filter(Boolean).at(-1) : String(err));

// On shutdown (and in tests): write everything waiting now.
// "Clear" (task 7.3): this API's entries made up to `upTo` are dropped from the queue, then a batch
// already being written is waited for (so the DELETE that follows also removes those).
// Calls still being answered at that moment are dropped when they finish (logCall). Remembered 10
// minutes (no call lasts that long), in this process: with several server processes, a call
// answered by another one at that moment could still appear.
const cleared = new Map<string, { upTo: Date; setAt: number }>();
const CLEAR_REMEMBERED_MS = 10 * 60_000;
export async function forgetWaitingCalls(apiId: string, upTo: Date) {
  for (const [id, c] of cleared) if (Date.now() - c.setAt > CLEAR_REMEMBERED_MS) cleared.delete(id);
  cleared.set(apiId, { upTo, setAt: Date.now() });
  queue = queue.filter((row) => row.apiId !== apiId || new Date(row.at) > upTo);
  await flushing?.catch(() => undefined);
}

// A few rounds at most: a write already running, then what arrived meanwhile; an unreachable
// database doesn't hold the shutdown.
export async function flushCallLogsNow() {
  for (let round = 0; round < 3 && (queue.length > 0 || flushing); round++) {
    if (timer) clearTimeout(timer);
    timer = undefined;
    await flush().catch(() => undefined);
  }
  if (timer) clearTimeout(timer);
  timer = undefined;
}
