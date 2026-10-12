// An API's call log (Phase 7, task 7.3): the list (filters, pages, "anything new?"), one entry in
// full with "Copy as curl", and Clear. Written by /v1 (v1/call-log.ts, 7.2); at most 500 per API,
// so every filter here reads at most 500 rows of one API through the (api_id, id DESC) index.
// Entries appear up to 0.5 s after the call (they are written in batches).
import type { Api, ApiCallLog, Prisma } from '../../../generated/prisma/client.js';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/app-error.js';
import { prisma } from '../../../lib/prisma.js';
import { CALL_LOG_KEPT } from '../../v1/call-log-store.js';
import { forgetWaitingCalls } from '../../v1/call-log.js';
import { buildCurl, tokenHeader } from '../testing/curl.js';
import type { LogsQuery } from './logs.schemas.js';

const IDS_IN_LIST = 5;

function where(api: Api, q: LogsQuery): Prisma.ApiCallLogWhereInput {
  const and: Prisma.ApiCallLogWhereInput[] = [{ apiId: api.id }];
  if (q.kind) and.push({ kind: q.kind });
  // Filters about a call imply kind = call (switch lines have no status / token / ids).
  const call = () => and.push({ kind: 'call' });
  if (q.status === 'ok') {
    call();
    and.push({ status: { gte: 200, lte: 299 }, envelopeStatus: 'success' });
  } else if (q.status === 'failed') {
    call();
    and.push({
      OR: [{ status: null }, { status: { lt: 200 } }, { status: { gt: 299 } }, { envelopeStatus: null }, { envelopeStatus: { not: 'success' } }],
    });
  } else if (typeof q.status === 'number') and.push({ status: q.status });
  if (q.token === 'none') {
    call();
    and.push({ tokenId: null });
  } else if (q.token) and.push({ tokenId: q.token });
  if (q.switched) {
    call();
    and.push({ switches: { isEmpty: q.switched === 'no' } });
  }
  if (q.check) and.push({ requestCheck: { path: ['ok'], equals: q.check === 'passed' } });
  if (q.id) and.push({ ids: { has: q.id } });
  if (q.from) and.push({ at: { gte: new Date(q.from) } });
  if (q.to) and.push({ at: { lte: new Date(q.to) } });
  return { AND: and };
}

// The list line: enough to scan and filter; bodies / headers only in the full entry.
function summary(row: ApiCallLog) {
  const check = row.requestCheck as { ok?: boolean } | null;
  return {
    id: String(row.id),
    kind: row.kind as 'call' | 'switch',
    at: row.at,
    method: row.method,
    path: row.path,
    status: row.status,
    envelopeStatus: row.envelopeStatus,
    errorCodes: row.errorCodes,
    tokenKind: row.tokenKind,
    tokenId: row.tokenId,
    tokenName: row.tokenName,
    header: row.header,
    idCount: row.idCount,
    ids: row.ids.slice(0, IDS_IN_LIST),
    found: row.found,
    durationMs: row.durationMs,
    switches: row.switches,
    checkOk: typeof check?.ok === 'boolean' ? check.ok : null,
    ip: row.ip,
    userAgent: row.userAgent,
    event: row.event,
  };
}

// The tokens named in these entries, with their CURRENT name and the agents using them now (the
// log keeps the name a token had at the time of the call).
async function tokensOf(api: Api, rows: ApiCallLog[]) {
  const ids = [...new Set(rows.map((r) => r.tokenId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return {};
  const [tokens, agents] = await Promise.all([
    prisma.apiToken.findMany({ where: { apiId: api.id, id: { in: ids } }, select: { id: true, name: true, hint: true, revokedAt: true } }),
    prisma.jivoxAgent.findMany({ where: { apiId: api.id, tokenId: { in: ids } }, select: { id: true, name: true, tokenId: true }, orderBy: { name: 'asc' } }),
  ]);
  return Object.fromEntries(
    tokens.map((t) => [
      t.id,
      { name: t.name, hint: t.hint, revoked: t.revokedAt !== null, agents: agents.filter((a) => a.tokenId === t.id).map((a) => ({ id: a.id, name: a.name })) },
    ]),
  );
}

export async function listLogs(api: Api, q: LogsQuery) {
  const filter = where(api, q);
  const page: Prisma.ApiCallLogWhereInput = q.before
    ? { AND: [filter, { id: { lt: BigInt(q.before) } }] }
    : q.after
      ? { AND: [filter, { id: { gt: BigInt(q.after) } }] }
      : filter;
  const [rows, matching, total, newest] = await Promise.all([
    prisma.apiCallLog.findMany({ where: page, orderBy: { id: 'desc' }, take: q.limit + 1 }),
    prisma.apiCallLog.count({ where: filter }),
    prisma.apiCallLog.count({ where: { apiId: api.id } }),
    prisma.apiCallLog.findFirst({ where: { apiId: api.id }, orderBy: { id: 'desc' }, select: { id: true } }),
  ]);
  const more = rows.length > q.limit;
  const shown = rows.slice(0, q.limit);
  return {
    entries: shown.map(summary),
    // older page: pass as `before` · null = nothing older
    next: more && !q.after ? String(shown.at(-1)!.id) : null,
    // `after` only: more new entries than `limit` arrived, the ones in between were left out (reload)
    gap: Boolean(q.after) && more,
    matching,
    total,
    kept: CALL_LOG_KEPT,
    newestId: newest ? String(newest.id) : null, // the next "anything new?" asks after this
    tokens: await tokensOf(api, shown),
  };
}

// The whole entry + "Copy as curl" (`<your token>` in the token's header; the body as sent).
export async function getLog(api: Api, logId: string) {
  const row = await prisma.apiCallLog.findFirst({ where: { id: BigInt(logId), apiId: api.id } });
  if (!row) throw new AppError(404, 'LOG_NOT_FOUND', 'No such entry in this API\'s log (the log keeps the newest 500)');
  const requestHeaders = (row.requestHeaders ?? {}) as Record<string, string>;
  const responseHeaders = (row.responseHeaders ?? null) as Record<string, string> | null;
  const sentBytes = Number(responseHeaders?.['content-length']);
  return {
    entry: {
      ...summary(row),
      ids: row.ids,
      query: row.query,
      body: row.body,
      bodyBytes: row.bodyBytes,
      bodyCut: row.body !== null && row.bodyBytes > Buffer.byteLength(row.body),
      requestHeaders: row.requestHeaders,
      meta: row.meta,
      requestCheck: row.requestCheck,
      responseHeaders,
      responseBody: row.responseBody,
      responseCut: row.responseBody !== null && Number.isFinite(sentBytes) && sentBytes > Buffer.byteLength(row.responseBody),
    },
    tokens: await tokensOf(api, [row]),
    ...(row.kind === 'call' && row.method && row.path ? curlOf(api, row, requestHeaders) : { curl: null, curlNotes: [] }),
  };
}

function curlOf(api: Api, row: ApiCallLog, requestHeaders: Record<string, string>) {
  const notes: string[] = [];
  const style = (row.header as 'x_api_key' | 'bearer' | null) ?? api.authHeader;
  if (row.tokenKind === 'none') notes.push('The original call sent no token; the command adds one.');
  else if (row.tokenKind !== 'this_api') notes.push("The original call's token was not a working token of this API; the command uses yours.");
  if (row.header && row.header !== api.authHeader) notes.push(`The original call sent the token in a header this API doesn't expect (it expects ${api.authHeader === 'bearer' ? 'Authorization: Bearer' : 'X-Api-Key'}): kept as sent.`);
  if (row.path!.includes('rtk_[Redacted]') || row.body?.includes('rtk_[Redacted]')) notes.push('Token-shaped text in the call was replaced by rtk_[Redacted].');
  if (row.body !== null && row.bodyBytes > Buffer.byteLength(row.body)) notes.push(`The body was ${row.bodyBytes} bytes; the log keeps the first 4 KB, so this command sends only that part.`);
  if (row.path!.length >= 2048) notes.push('The address was cut at 2 KB in the log.');
  const curl = buildCurl({
    method: row.method!,
    url: `${env.PUBLIC_BASE_URL}${row.path}`,
    header: tokenHeader(style),
    ...(row.body !== null && { rawBody: row.body, contentType: requestHeaders['content-type'] }),
  });
  return { curl, curlNotes: notes };
}

// "Clear": the API's calls go (switch lines stay: they are the audit of who broke what). Calls made
// before now and still waiting to be written are dropped too.
export async function clearLogs(api: Api) {
  const now = new Date();
  await forgetWaitingCalls(api.id, now);
  const { count } = await prisma.apiCallLog.deleteMany({ where: { apiId: api.id, kind: 'call', at: { lte: now } } });
  return { cleared: count, clearedAt: now };
}
