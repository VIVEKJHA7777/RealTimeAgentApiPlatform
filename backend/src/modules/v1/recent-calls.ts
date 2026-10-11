// Recent calls (task 4.8b): the last 5 calls to each API's live URL, shown on its Test tab, so the
// owner sees what Jivox (or anyone) sent and what /v1 answered: successes AND failures (no token,
// expired, wrong header, not published, bad body…).
//
// How a call is recorded, without slowing /v1:
//   1. recordCalls (first middleware of /v1) starts a "note" for /v1/<brand>/<api> calls; the
//      JSON parser keeps the first 2 KB of the body in it; answerCall / sendFailure fill in the
//      rest (API, token name, ids, found, error).
//   2. When the answer has gone out, the note becomes a RecentCall and joins the API's list in
//      memory. Calls without a usable token are matched to the API by its address (one indexed
//      lookup, cached 10 s).
//   3. The list is saved at most once a second per API (one upsert that keeps the newest 5).
// Not recorded: the app's own self-check (it would push Jivox's calls out), unknown paths.
// Never stored: token headers; token-shaped text in the URL / body is scrubbed.
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../lib/app-error.js';
import { logger, scrubTokens } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { readToken, SELF_CHECK_HEADER } from './v1.service.js';

export const RECENT_CALLS_KEPT = 5;
const SAVE_EVERY_MS = 1_000;
const MAX_TEXT = 2_048; // body / path shown, in characters
const MAX_IDS_SHOWN = 10;
const MAX_ID_LENGTH = 100;
const API_LOOKUP_TTL_MS = 10_000;

// not_checked = a token was sent but the call failed before it was read (invalid JSON, too large)
export type TokenKind = 'this_api' | 'other_api' | 'unknown' | 'not_checked' | 'none';
export type RecentCall = {
  id: string; // for lists (React keys); not secret
  at: string; // when the call arrived (ISO)
  method: string;
  path: string; // path + query, scrubbed, ≤ 2 KB
  status: number | null; // null = the caller hung up before the answer
  durationMs: number;
  errorCode: string | null; // failure envelope's code (UNAUTHORIZED, TOKEN_EXPIRED…)
  errorMessage: string | null;
  tokenKind: TokenKind; // this_api = one of this API's tokens (maybe revoked / expired: see errorCode)
  tokenName: string | null; // only for this_api
  header: 'x_api_key' | 'bearer' | null; // where the token was sent (null = no token header)
  idCount: number | null; // null = the call failed before ids were read
  ids: string[]; // the first 10
  found: number | null;
  body: string | null; // the first 2 KB as sent (scrubbed); null = no body
  bodyBytes: number; // the whole body's size
  userAgent: string | null;
  ip: string | null;
};

// Filled in while the call is answered (res.locals.v1Call).
export type CallNote = {
  brandSlug: string;
  apiSlug: string;
  at: Date;
  started: bigint;
  apiId?: string;
  tokenKind: TokenKind;
  tokenName?: string;
  header: RecentCall['header'];
  ids?: string[];
  found?: number;
  body?: string;
  bodyBytes: number;
};
export const callNote = (res: Response) => res.locals.v1Call as CallNote | undefined;

// ── 1. Start a note (first middleware of the /v1 router) ──
export function recordCalls(req: Request, res: Response, next: NextFunction) {
  const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(req.path);
  if (!match || req.get(SELF_CHECK_HEADER.name) === SELF_CHECK_HEADER.value) return next();
  const header = readToken(req)?.style ?? null;
  const note: CallNote = {
    brandSlug: slugOf(match[1]),
    apiSlug: slugOf(match[2]),
    at: new Date(),
    started: process.hrtime.bigint(),
    tokenKind: header ? 'not_checked' : 'none',
    header,
    bodyBytes: Number(req.get('content-length')) || 0,
  };
  res.locals.v1Call = note;
  // 'close' also fires when the caller hangs up first (then writableFinished is false).
  res.once('close', () => void finish(req, res, note));
  next();
}

function slugOf(part: string) {
  try {
    return decodeURIComponent(part).toLowerCase();
  } catch {
    return part.toLowerCase();
  }
}

// The JSON parser's `verify` hook: keep the start of the body as sent (also when it isn't JSON).
export function keepBody(res: Response, buf: Buffer) {
  const note = callNote(res);
  if (!note) return;
  note.bodyBytes = buf.length;
  note.body = shorten(buf.subarray(0, MAX_TEXT * 4 + 64).toString('utf8'));
}

// Scrub BEFORE cutting: a token is 47 characters, so one that starts inside the kept part is
// always whole in the extra 64 and gets scrubbed (no half token left at the cut).
function shorten(text: string) {
  return scrubTokens(text.slice(0, MAX_TEXT + 64)).slice(0, MAX_TEXT);
}

// ── 2. The answer went out: note → RecentCall → the API's list ──
async function finish(req: Request, res: Response, note: CallNote) {
  try {
    const apiId = note.apiId ?? (await apiIdOf(note.brandSlug, note.apiSlug));
    if (!apiId) return; // no such API: nothing to show anyone
    const failure = res.locals.v1Failure as { code: string; message: string } | undefined;
    add(apiId, {
      id: randomBytes(6).toString('hex'),
      at: note.at.toISOString(),
      method: req.method,
      path: shorten(req.originalUrl),
      status: res.writableFinished ? res.statusCode : null,
      durationMs: Math.round(Number(process.hrtime.bigint() - note.started) / 1e5) / 10,
      errorCode: failure?.code ?? null,
      errorMessage: failure?.message ?? null,
      tokenKind: note.tokenKind,
      tokenName: note.tokenKind === 'this_api' ? (note.tokenName ?? null) : null,
      header: note.header,
      idCount: note.ids?.length ?? null,
      ids: (note.ids ?? []).slice(0, MAX_IDS_SHOWN).map((id) => shorten(id).slice(0, MAX_ID_LENGTH)),
      found: note.found ?? null,
      body: note.body ?? null,
      bodyBytes: note.bodyBytes,
      userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
      ip: req.ip ?? null,
    });
  } catch (err) {
    logger.warn({ err }, 'Could not record a /v1 call');
  }
}

// /v1/<brand>/<api> → the API's id, for calls whose token didn't tell us. Cached (also "no such
// API") so a flood of token-less calls costs one query per address per 10 s. Slugs never change.
const apiIds = new Map<string, { id: string | null; until: number }>();
async function apiIdOf(brandSlug: string, apiSlug: string) {
  const key = `${brandSlug}/${apiSlug}`;
  const cached = apiIds.get(key);
  if (cached && cached.until > Date.now()) return cached.id;
  const [row] = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM apis a JOIN organizations o ON o.id = a.organization_id
    WHERE o.slug = ${brandSlug} AND a.slug = ${apiSlug}`;
  if (apiIds.size > 10_000) apiIds.clear(); // bounded memory
  apiIds.set(key, { id: row?.id ?? null, until: Date.now() + API_LOOKUP_TTL_MS });
  return row?.id ?? null;
}

// ── 3. Saving: newest 5 per API, at most once a second per API ──
type Waiting = { calls: RecentCall[]; saving: RecentCall[]; timer?: NodeJS.Timeout; lastSave: number };
const waiting = new Map<string, Waiting>(); // apiId → calls not saved yet

const newestFirst = (calls: RecentCall[]) =>
  calls.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1)).slice(0, RECENT_CALLS_KEPT);

function add(apiId: string, call: RecentCall) {
  let w = waiting.get(apiId);
  if (!w) waiting.set(apiId, (w = { calls: [], saving: [], lastSave: 0 }));
  w.calls = newestFirst([call, ...w.calls]);
  schedule(apiId, w);
}

function schedule(apiId: string, w: Waiting) {
  if (w.timer || w.saving.length > 0 || w.calls.length === 0) return;
  w.timer = setTimeout(() => void save(apiId), Math.max(0, w.lastSave + SAVE_EVERY_MS - Date.now()));
}

async function save(apiId: string) {
  const w = waiting.get(apiId);
  if (!w) return;
  w.timer = undefined;
  w.saving = w.calls;
  w.calls = [];
  try {
    // New calls + the saved ones, minus any made before the last Clear, newest 5. One statement,
    // so two server processes saving at once can't lose each other's calls.
    await prisma.$executeRaw`
      INSERT INTO api_recent_calls (api_id, calls, updated_at)
      VALUES (${apiId}, ${JSON.stringify(w.saving)}::jsonb, now())
      ON CONFLICT (api_id) DO UPDATE SET
        calls = COALESCE((
          SELECT jsonb_agg(c ORDER BY c->>'at' DESC, c->>'id' DESC) FROM (
            SELECT c FROM jsonb_array_elements(EXCLUDED.calls || api_recent_calls.calls) AS c
            WHERE api_recent_calls.cleared_at IS NULL OR (c->>'at')::timestamptz > api_recent_calls.cleared_at
            ORDER BY c->>'at' DESC, c->>'id' DESC
            LIMIT ${RECENT_CALLS_KEPT}) newest), '[]'::jsonb),
        updated_at = now()`;
  } catch (err) {
    if (isMissingApi(err)) {
      waiting.delete(apiId); // the API was deleted meanwhile: its calls go with it
      return;
    }
    // e.g. the database is busy: keep them and try again in a second.
    logger.warn({ err, apiId }, 'Could not save recent /v1 calls; will retry');
    w.calls = newestFirst([...w.calls, ...w.saving]);
  } finally {
    w.saving = [];
    // Counted from the END of the save: a save that waited for a busy database doesn't let the
    // next one follow closer than 1 s.
    w.lastSave = Date.now();
  }
  if (w.calls.length > 0) schedule(apiId, w);
  else if (waiting.size > 1_000) waiting.delete(apiId); // keep memory small (the 1 s rule may restart)
}

// Raw SQL errors carry Postgres' code (23503 = foreign key) somewhere in the message / cause.
function isMissingApi(err: unknown) {
  return /23503|foreign key/i.test(`${String(err)} ${JSON.stringify((err as { meta?: unknown })?.meta ?? '')}`);
}

// On shutdown: save what's waiting (calls in the last second).
export async function saveRecentCallsNow() {
  await Promise.all(
    [...waiting.entries()].map(([apiId, w]) => {
      if (w.timer) clearTimeout(w.timer);
      w.timer = undefined;
      return w.calls.length > 0 && w.saving.length === 0 ? save(apiId) : undefined;
    }),
  );
}

// ── The Test tab ──
// The newest 5: saved ones + those still waiting in this process (so a call shows at once).
export async function listRecentCalls(apiId: string) {
  const [row] = await prisma.$queryRaw<{ calls: RecentCall[]; cleared_at: Date | null }[]>`
    SELECT calls, cleared_at FROM api_recent_calls WHERE api_id = ${apiId}`;
  const w = waiting.get(apiId);
  const seen = new Set<string>();
  const all = [...(w?.calls ?? []), ...(w?.saving ?? []), ...(row?.calls ?? [])].filter(
    (c) => !seen.has(c.id) && seen.add(c.id) && (!row?.cleared_at || new Date(c.at) > row.cleared_at),
  );
  return { calls: newestFirst(all), kept: RECENT_CALLS_KEPT, clearedAt: row?.cleared_at ?? null };
}

// "Clear": empties the list; calls made before now are never added back.
export async function clearRecentCalls(apiId: string) {
  const now = new Date();
  const w = waiting.get(apiId);
  if (w) w.calls = [];
  try {
    await prisma.$executeRaw`
      INSERT INTO api_recent_calls (api_id, calls, cleared_at, updated_at) VALUES (${apiId}, '[]'::jsonb, ${now}, now())
      ON CONFLICT (api_id) DO UPDATE SET calls = '[]'::jsonb, cleared_at = ${now}, updated_at = now()`;
  } catch (err) {
    if (isMissingApi(err)) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
    throw err;
  }
  return { calls: [] as RecentCall[], kept: RECENT_CALLS_KEPT, clearedAt: now };
}
