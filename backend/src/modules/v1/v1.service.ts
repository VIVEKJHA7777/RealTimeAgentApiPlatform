// The live API (Phase 4, task 4.3): what Jivox calls.
//   GET  /v1/<brand-slug>/<api-slug>?ids=SKU-1,SKU-2          (the API's request design)
//   POST /v1/<brand-slug>/<api-slug>  { "items": [ { "sku": "SKU-1" } ] }
//   token in X-Api-Key: <token>  or  Authorization: Bearer <token>  (the API's header style)
//
// Steps (each failure answers with the contract envelope, see envelope.ts):
//   1. token from the request → its SHA-256 → ONE query: the token + its API + brand + data source
//        missing / unknown / revoked / for another API / in the wrong header → 401 UNAUTHORIZED
//        past its expiry → 401 TOKEN_EXPIRED (with the date)
//      The token is checked BEFORE anything about the API is said: without a valid token every
//      path looks the same (401), so nobody can probe which brands / APIs exist.
//   2. the API must be published (else 404) and called with its designed method (else 405)
//   3. ids from the query (GET) or the per-row list (POST): trimmed, empty ones dropped, each
//      once (first-seen order); none → 400, more than maxIdsPerCall → 400 TOO_MANY_IDS
//   4. ONE query for the rows, in the data's CURRENT version (read inside the same statement:
//      during a replace a call sees the old or the new data, never a mix, never "nothing")
//   5. buildResponse (the same code as the Design preview) → 200 envelope, unknown ids in errors[]
// Other request values (literals, chat context, POST per-row extras) are accepted and ignored.
// /v1 never decrypts tokens: the hash is all it needs.
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { hashApiToken, TOKEN_PATTERN } from '../../lib/api-token.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { buildResponse, type StoredRow } from '../apis/design/build-response.js';
import type { RequestTemplate, StoredDesign } from '../apis/design/design.schemas.js';
import { checkRequest, defaultRequest, type RequestSummary } from '../apis/design/request-rules.js';
import { getFeedSchema } from '../jivox/feed-schemas.js';
import { V1Error } from './envelope.js';
import type { CallNote } from './recent-calls.js';
import { checkCall } from './request-check.js';
import { applyToBody, httpStatusFailure, inScope, on, strictFailure, type Envelope, type LiveSwitch, type SwitchState } from './test-switches.js';

const HEADER_TEXT = {
  x_api_key: 'X-Api-Key: <token>',
  bearer: 'Authorization: Bearer <token>',
} as const;
type HeaderStyle = keyof typeof HEADER_TEXT;

// ── 1. Token ──
// Where the token came from matters: only the API's chosen header style is accepted.
export function readToken(req: Request): { token: string; style: HeaderStyle } | null {
  const apiKey = req.get('x-api-key')?.trim();
  if (apiKey) return { token: apiKey, style: 'x_api_key' };
  const auth = req.get('authorization')?.trim();
  const bearer = auth ? /^Bearer\s+(\S+)$/i.exec(auth) : null;
  if (bearer) return { token: bearer[1], style: 'bearer' };
  return null;
}

type Resolved = {
  token_id: string;
  token_name: string;
  revoked_at: Date | null;
  expires_at: Date | null;
  last_used_at: Date | null;
  api_id: string;
  api_slug: string;
  brand_slug: string;
  status: string;
  auth_header: HeaderStyle;
  feed_type: string;
  design: StoredDesign | null;
  design_version: number;
  data_source_id: string;
  id_column: string;
  switches: LiveSwitch[]; // the API's test switches still on (7.4), whatever their scope
};

const unauthorized = (message: string) => new V1Error(401, 'UNAUTHORIZED', message);
const INVALID = 'Invalid token. Send the API token in the header this API expects (X-Api-Key or Authorization: Bearer).';

// `note` (Recent calls, task 4.8b) learns which token / header / API this call was, as far as known.
async function resolveToken(req: Request, brandSlug: string, apiSlug: string, now: Date, note?: CallNote) {
  const sent = readToken(req);
  if (note && sent) note.tokenKind = 'unknown'; // until it's found below
  if (!sent) {
    throw unauthorized('Missing token. Send it as "X-Api-Key: <token>" or "Authorization: Bearer <token>", as this API expects.');
  }
  // Not even shaped like one of ours: no need to ask the database.
  if (!TOKEN_PATTERN.test(sent.token)) throw unauthorized(INVALID);

  const [row] = await prisma.$queryRaw<Resolved[]>`
    SELECT t.id AS token_id, t.name AS token_name, t.revoked_at, t.expires_at, t.last_used_at,
           a.id AS api_id, a.slug AS api_slug, o.slug AS brand_slug, a.status::text AS status,
           a.auth_header::text AS auth_header, a.feed_type::text AS feed_type,
           a.design, a.design_version, d.id AS data_source_id, d.id_column,
           COALESCE((SELECT json_agg(json_build_object('kind', s.kind, 'options', s.options, 'tokenId', s.token_id, 'own', s.apply_to_own_checks))
                     FROM api_test_switches s WHERE s.api_id = a.id AND s.ends_at > now()), '[]'::json) AS switches
    FROM api_tokens t
    JOIN apis a ON a.id = t.api_id
    JOIN organizations o ON o.id = a.organization_id
    JOIN data_sources d ON d.id = a.data_source_id
    WHERE t.token_hash = ${hashApiToken(sent.token)}`;
  if (!row) throw unauthorized(INVALID);
  // A token works only for its own API (P4-3). Slugs are lower-case; compare the same way.
  if (row.brand_slug !== brandSlug.toLowerCase() || row.api_slug !== apiSlug.toLowerCase()) {
    if (note) note.tokenKind = 'other_api'; // recorded on the API of the URL, without the name
    throw unauthorized("This token belongs to a different API, or this API's address has changed. Check the URL and use a token made for this API.");
  }
  if (note) Object.assign(note, { apiId: row.api_id, tokenKind: 'this_api', tokenName: row.token_name, tokenId: row.token_id });
  if (row.revoked_at) throw unauthorized('This token was revoked. Use an active token of this API.');
  if (row.expires_at && row.expires_at <= now) {
    const when = row.expires_at.toISOString().replace(/:\d{2}\.\d{3}Z$/, ' UTC').replace('T', ' ');
    throw new V1Error(401, 'TOKEN_EXPIRED', `This token expired on ${when}. Extend or renew it on the API's Test tab.`);
  }
  if (sent.style !== row.auth_header) {
    throw unauthorized(`This API expects the token as "${HEADER_TEXT[row.auth_header]}".`);
  }
  return row;
}

// The app's own self-check (task 4.5) calls /v1 like Jivox would. It sends this header so the call
// doesn't count as the token being "used". The value is random per server start: nobody outside
// this process can send it.
export const SELF_CHECK_HEADER = { name: 'x-platform-self-check', value: randomBytes(16).toString('hex') };

// ── last_used_at: at most one write per token per minute, never delaying the answer (P4-8) ──
const LAST_USED_EVERY_MS = 60_000;
const lastUsedWrites = new Map<string, number>(); // tokenId → when we last wrote
function noteTokenUse(row: Resolved, now: Date) {
  const last = Math.max(lastUsedWrites.get(row.token_id) ?? 0, row.last_used_at?.getTime() ?? 0);
  if (now.getTime() - last < LAST_USED_EVERY_MS) return;
  lastUsedWrites.set(row.token_id, now.getTime());
  if (lastUsedWrites.size > 10_000) lastUsedWrites.clear(); // bounded memory
  // The WHERE repeats the minute rule in SQL: several server processes can't over-write either.
  prisma.$executeRaw`
    UPDATE api_tokens SET last_used_at = ${now}
    WHERE id = ${row.token_id} AND (last_used_at IS NULL OR last_used_at < ${new Date(now.getTime() - LAST_USED_EVERY_MS)})`
    .catch((err: unknown) => logger.warn({ err, tokenId: row.token_id }, 'Could not record token use'));
}

// ── 2. The request design, checked once per design version (pure, but no need to redo it per call) ──
const summaries = new Map<string, { request: RequestTemplate; summary: RequestSummary }>();
export type RuntimeApi = { id: string; feedType: string; design: StoredDesign; designVersion: number };
export function requestOf(api: RuntimeApi) {
  const key = `${api.id}:${api.designVersion}:${api.feedType}`;
  let found = summaries.get(key);
  if (!found) {
    const feedSchema = getFeedSchema(api.feedType as never);
    const request = api.design.request ?? defaultRequest(feedSchema);
    const { summary } = checkRequest(request, feedSchema);
    // A published API always has a valid design (saves are checked); this is a safety net.
    if (!summary) throw new V1Error(500, 'INTERNAL_ERROR', "This API's request design is invalid. Open its Design tab and save it again.");
    found = { request, summary };
    if (summaries.size > 1_000) summaries.clear();
    summaries.set(key, found);
  }
  return found;
}

// ── 3. Ids ──
function idsFromQuery(query: Record<string, unknown>, idParam: string): string[] {
  const value = query[idParam];
  // ?ids=a,b  or repeated ?ids=a&ids=b (both accepted)
  const parts = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
  if (parts.length === 0) throw new V1Error(400, 'BAD_REQUEST', `No ids sent. Put them in the "${idParam}" query parameter, separated by commas.`);
  return parts.flatMap((p) => p.split(','));
}

function idsFromBody(body: unknown, summary: Extract<RequestSummary, { method: 'POST' }>): string[] {
  const where = summary.rowsPath.length > 0 ? `"${summary.rowsPath.join('.')}"` : 'the body';
  if (body === undefined || body === null || typeof body !== 'object') {
    throw new V1Error(400, 'BAD_REQUEST', `Send a JSON body with the ids in ${where}.`);
  }
  const list = summary.rowsPath.reduce<unknown>((node, key) => (node as Record<string | number, unknown> | null)?.[key], body);
  if (!Array.isArray(list)) throw new V1Error(400, 'BAD_REQUEST', `${where} must be a list of objects, one per id.`);
  return list.map((entry, i) => {
    const id = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>)[summary.idKey] : undefined;
    if (typeof id === 'string') return id;
    if (typeof id === 'number' && Number.isFinite(id)) return String(id);
    const row = summary.rowsPath.length > 0 ? `${summary.rowsPath.join('.')}[${i}]` : `Row ${i}`;
    throw new V1Error(400, 'BAD_REQUEST', `${row} has no "${summary.idKey}" (each object needs the id as text).`);
  });
}

function cleanIds(raw: string[], max: number) {
  const ids = [...new Set(raw.map((id) => id.trim()).filter((id) => id !== ''))];
  if (ids.length === 0) throw new V1Error(400, 'BAD_REQUEST', 'No ids sent (all were empty).');
  if (ids.length > max) throw new V1Error(400, 'TOO_MANY_IDS', `Too many ids: ${ids.length}. This API answers at most ${max} per call.`);
  return ids;
}

// The ids of a request, exactly as /v1 reads them (also used by "Try it", task 4.5).
export function extractIds(summary: RequestSummary, max: number, query: Record<string, unknown>, body: unknown) {
  return cleanIds(summary.method === 'GET' ? idsFromQuery(query, summary.idParam) : idsFromBody(body, summary), max);
}

// The answer for these ids: ONE statement reads the rows of the data's current version (step 4).
export async function answerIds(api: RuntimeApi, dataSourceId: string, idColumn: string, ids: string[], now = new Date()) {
  const found = await prisma.$queryRaw<{ external_id: string; data: Record<string, string | null> }[]>`
    SELECT r.external_id, r.data FROM records r
    WHERE r.data_source_id = ${dataSourceId}
      AND r.generation = (SELECT active_generation FROM data_sources WHERE id = ${dataSourceId})
      AND r.external_id = ANY(${ids})`;
  const rowsById = new Map<string, StoredRow>(found.map((r) => [r.external_id, { externalId: r.external_id, data: r.data }]));
  return { response: buildResponse(ids, rowsById, api.design, idColumn, now).response, rowsById };
}

// ── The whole call ──
// `switches` (7.4): filled with the test switches that apply to this call (a working token of this
// API, in scope); sendV1 and the call log read it. Order: see test-switches.ts.
export async function answerCall(req: Request, brandSlug: string, apiSlug: string, note?: CallNote, switches?: SwitchState) {
  const now = new Date();
  const row = await resolveToken(req, brandSlug, apiSlug, now, note);
  const ownCheck = req.get(SELF_CHECK_HEADER.name) === SELF_CHECK_HEADER.value;
  if (!ownCheck) noteTokenUse(row, now);
  if (switches) switches.active = row.switches.filter((sw) => inScope(sw, row.token_id, ownCheck));
  const statusSwitch = switches && httpStatusFailure(switches);
  if (statusSwitch) throw statusSwitch;

  if (row.status !== 'published' || !row.design) {
    throw new V1Error(404, 'NOT_FOUND', "This API isn't published yet. Publish it on its Test tab.");
  }
  const api: RuntimeApi = { id: row.api_id, feedType: row.feed_type, design: row.design, designVersion: row.design_version };
  const { request, summary } = requestOf(api);
  if (note) note.template = { request, summary }; // the call log's request check (7.2), after answering
  if (req.method !== summary.method) {
    throw new V1Error(405, 'METHOD_NOT_ALLOWED', `This API is called with ${summary.method}.`, { Allow: summary.method });
  }
  if (switches && on(switches, 'strict')) {
    const strict = strictFailure(switches, checkCall(request, summary, req.method, req.query as Record<string, unknown>, req.body).check);
    if (strict) throw strict;
  }
  const ids = extractIds(summary, request.maxIdsPerCall, req.query as Record<string, unknown>, req.body);
  if (note) note.ids = ids;
  const { response, rowsById } = await answerIds(api, row.data_source_id, row.id_column, ids, now);
  if (note) note.found = rowsById.size;
  return switches ? applyToBody(switches, response as Envelope, ids, api.design) : response;
}
