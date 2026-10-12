// "Try it" and the self-check (Phase 4, task 4.5): the Test tab's backend.
//
// Try it (P4-9): what would /v1 answer for these ids? Runs INSIDE the server with the same code as
// /v1 (request → ids → rows → answer), the SAVED design, no token, any status (works on drafts).
// It builds the request Jivox would send (sample request), reads the ids back out of it the way
// /v1 does (so e.g. a comma inside an id splits it, as it would live), then answers.
//
// Self-check (P4-10): the checks Jivox's verification runs on an API, with a ✓ / ✗ and a reason each.
//   live    (published + a usable token): a REAL HTTP call to PUBLIC_BASE_URL/v1/… with the token in
//           the API's header, plus one call WITHOUT a token (must be refused). Proves the address
//           answers, not just our code.
//   in-app  (otherwise): the content checks on the in-server answer; "published" / "token" fail and
//           the network checks are skipped with the reason.
// Content checks: 2xx · Cache-Control no-store · JSON envelope · status "success" · every sent id
// exactly once under the id key · every field present with its contract type · under 3 s.
import { performance } from 'node:perf_hooks';
import type { Api } from '../../../generated/prisma/client.js';
import { decryptToken } from '../../../lib/api-token.js';
import { AppError } from '../../../lib/app-error.js';
import { env } from '../../../config/env.js';
import { prisma } from '../../../lib/prisma.js';
import { failureBody, V1Error } from '../../v1/envelope.js';
import { checkCall } from '../../v1/request-check.js';
import { applyToBody, dropsNoStore, httpStatusFailure, newSwitchState, NOT_JSON_TEXT, on, sendsNotJson, slowMs, strictFailure, type Envelope, type LiveSwitch } from '../../v1/test-switches.js';
import { answerIds, extractIds, requestOf, SELF_CHECK_HEADER, type RuntimeApi } from '../../v1/v1.service.js';
import { buildSampleRequest, queryString, type StoredRow } from '../design/build-response.js';
import type { FIELD_TYPES, StoredDesign } from '../design/design.schemas.js';

type FieldType = (typeof FIELD_TYPES)[number];
import { buildCurl, tokenHeader } from './curl.js';
import type { TestInput } from './testing.schemas.js';

export const DEFAULT_TEST_IDS = 2; // like the contract's Sample A
export const JIVOX_TIME_LIMIT_MS = 3000;

// ── Shared: the API as /v1 would see it ──
export async function loadContext(api: Api, brandSlug: string) {
  const fresh = await prisma.api.findUnique({
    where: { id: api.id },
    select: {
      slug: true,
      status: true,
      authHeader: true,
      feedType: true,
      design: true,
      designVersion: true,
      dataSource: { select: { id: true, idColumn: true, activeGeneration: true } },
    },
  });
  if (!fresh) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
  if (!fresh.design || fresh.designVersion === 0) {
    throw new AppError(409, 'NO_DESIGN', 'Save a response design first (Design tab): it decides what the API answers.');
  }
  if (fresh.dataSource.activeGeneration === null) {
    throw new AppError(409, 'NO_DATA', 'This API has no data yet (the import is running or failed).');
  }
  const runtime: RuntimeApi = { id: api.id, feedType: fresh.feedType, design: fresh.design as StoredDesign, designVersion: fresh.designVersion };
  let found;
  try {
    found = requestOf(runtime);
  } catch (err) {
    if (err instanceof V1Error) {
      throw new AppError(409, 'DESIGN_INVALID', "The saved request design doesn't fit this API's feed type any more. Fix it on the Design tab.", { cause: err });
    }
    throw err;
  }
  const path = `/v1/${brandSlug}/${fresh.slug}`;
  return { ...fresh, runtime, ...found, path, url: `${env.PUBLIC_BASE_URL}${path}`, ds: fresh.dataSource };
}
export type Context = Awaited<ReturnType<typeof loadContext>>;

export async function defaultIds(ctx: Context) {
  const rows = await prisma.$queryRaw<{ external_id: string }[]>`
    SELECT external_id FROM records
    WHERE data_source_id = ${ctx.ds.id} AND generation = ${ctx.ds.activeGeneration}
    ORDER BY position LIMIT ${DEFAULT_TEST_IDS}`;
  return rows.map((r) => r.external_id);
}

// The request Jivox would send for these ids. POST {column} values are filled from OUR data for
// the field mapped to that Jivox column (Jivox fills them from its own copy of the feed).
export async function sampleFor(ctx: Context, ids: string[]) {
  const found = await prisma.$queryRaw<{ external_id: string; data: Record<string, string | null> }[]>`
    SELECT external_id, data FROM records
    WHERE data_source_id = ${ctx.ds.id} AND generation = ${ctx.ds.activeGeneration} AND external_id = ANY(${ids})`;
  const rows = new Map<string, StoredRow>(found.map((r) => [r.external_id, { externalId: r.external_id, data: r.data }]));
  const design = ctx.runtime.design;
  const columnValue = (id: string, jivoxColumn: string) => {
    const field = design.fields.find((f) => f.jivoxColumn === jivoxColumn);
    const row = rows.get(id);
    if (!field || !row) return '';
    return (field.sourceColumn === ctx.ds.idColumn ? row.externalId : row.data[field.sourceColumn]) ?? '';
  };
  const sample = buildSampleRequest(ctx.request, ctx.summary, ids, columnValue);
  const header = tokenHeader(ctx.authHeader);
  return sample.method === 'GET'
    ? { method: 'GET' as const, url: `${ctx.url}?${queryString(sample.query)}`, query: sample.query, body: undefined, header }
    : { method: 'POST' as const, url: ctx.url, query: undefined, body: sample.body, header };
}
export type Sample = Awaited<ReturnType<typeof sampleFor>>;

export function describeRequest(sample: Sample) {
  return {
    method: sample.method,
    url: sample.url,
    headers: { [sample.header[0]]: sample.header[1], ...(sample.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(sample.method === 'GET' ? { query: sample.query } : { body: sample.body }),
  };
}

const V1_HEADERS = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };

// Test switches for the app's own in-app answer (7.4, P7-3): only those on for the WHOLE API (no
// token here) with "apply to our own checks" ticked.
async function ownSwitches(apiId: string) {
  const rows = await prisma.apiTestSwitch.findMany({ where: { apiId, tokenId: null, applyToOwnChecks: true, endsAt: { gt: new Date() } } });
  return rows.map((r): LiveSwitch => ({ kind: r.kind as LiveSwitch['kind'], options: r.options as Record<string, unknown>, tokenId: null, own: true }));
}

// The answer /v1 would give for this sample request, computed in this process (with the same
// test switches /v1 would apply to the app's own checks; `switches` = those that changed it).
// `withSwitches: false`: the contract's sample answer (contract.ts), which must never be broken on purpose.
export async function answerInApp(ctx: Context, sample: Sample, { withSwitches = true } = {}) {
  const started = performance.now();
  const switches = newSwitchState();
  if (withSwitches) switches.active = await ownSwitches(ctx.runtime.id);
  let status = 200;
  let body: unknown;
  try {
    const statusSwitch = httpStatusFailure(switches);
    if (statusSwitch) throw statusSwitch;
    // The ids are read back OUT of the request exactly like /v1 reads them.
    const query = sample.method === 'GET' ? Object.fromEntries(new URLSearchParams(sample.url.split('?')[1] ?? '')) : {};
    if (on(switches, 'strict')) {
      const strict = strictFailure(switches, checkCall(ctx.request, ctx.summary, sample.method, query, sample.body).check);
      if (strict) throw strict;
    }
    const ids = extractIds(ctx.summary, ctx.request.maxIdsPerCall, query, sample.body);
    body = applyToBody(switches, (await answerIds(ctx.runtime, ctx.ds.id, ctx.ds.idColumn, ids)).response as Envelope, ids, ctx.runtime.design);
  } catch (err) {
    if (!(err instanceof V1Error)) throw err;
    status = err.status;
    body = failureBody(err);
  }
  const headers: Record<string, string> = { ...V1_HEADERS };
  if (sendsNotJson(switches)) {
    body = NOT_JSON_TEXT;
    headers['Content-Type'] = 'text/plain; charset=utf-8';
  }
  if (dropsNoStore(switches)) delete headers['Cache-Control'];
  const wait = slowMs(switches);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return { status, headers, body, durationMs: Math.round(performance.now() - started), switches: switches.applied };
}

// ── Try it ──
export async function tryApi(api: Api, brandSlug: string, input: TestInput) {
  const ctx = await loadContext(api, brandSlug);
  const ids = input.ids ?? (await defaultIds(ctx));
  const sample = await sampleFor(ctx, ids);
  const response = await answerInApp(ctx, sample);
  return {
    mode: 'in-app' as const,
    status: ctx.status, // draft answers here too; live /v1 only once published
    designVersion: ctx.designVersion,
    ids, // the ids asked for (the first rows when none were sent)
    request: describeRequest(sample),
    curl: buildCurl({ method: sample.method, url: sample.url, header: sample.header, body: sample.body }),
    // switches: the test switches that changed this answer (7.4: only those ticked "apply to our own checks")
    response: { status: response.status, headers: response.headers, body: response.body, switches: response.switches },
    durationMs: response.durationMs,
  };
}

// ── Self-check ──
export type Check = { id: string; label: string; status: 'pass' | 'fail' | 'warn' | 'skip'; detail: string };

export function matchesType(type: FieldType, value: unknown) {
  switch (type) {
    case 'int':
      return typeof value === 'number' && Number.isInteger(value);
    case 'float':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'image':
      return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value);
    default:
      return typeof value === 'string';
  }
}
export const show = (value: unknown) => (typeof value === 'string' ? `text "${value.length > 40 ? value.slice(0, 40) + '…' : value}"` : JSON.stringify(value));
export function listed(problems: string[], max = 5) {
  return problems.slice(0, max).join('; ') + (problems.length > max ? `; and ${problems.length - max} more` : '');
}

// The content checks Jivox's verification runs on an answer.
function contentChecks(ctx: Context, ids: string[], res: { status: number; headers: Record<string, string>; body: unknown; durationMs: number }): Check[] {
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, okDetail: string, badDetail: string) =>
    checks.push({ id, label, status: ok ? 'pass' : 'fail', detail: ok ? okDetail : badDetail });

  add('status_2xx', 'Answers with a 2xx status', res.status >= 200 && res.status < 300, `HTTP ${res.status}`, `HTTP ${res.status}${errorText(res.body)}`);
  const cache = res.headers['Cache-Control'] ?? '';
  add('no_store', 'Cache-Control: no-store', /\bno-store\b/i.test(cache), 'Sent on the answer', cache ? `Sent "${cache}"` : 'Header missing');
  const body = res.body as { status?: unknown; generated_at?: unknown; data?: unknown; errors?: unknown } | null;
  const isEnvelope = !!body && typeof body === 'object' && typeof body.status === 'string' && typeof body.generated_at === 'string' && Array.isArray(body.data) && Array.isArray(body.errors);
  add('envelope', 'JSON in the contract envelope', isEnvelope, 'status, generated_at, data[], errors[]', 'The body is not the contract envelope (status, generated_at, data, errors)');
  add('success', 'status is "success"', isEnvelope && body!.status === 'success', '"success"', isEnvelope ? `"${String(body!.status)}"${errorText(body)}` : 'No envelope');

  const design = ctx.runtime.design;
  const idKey = design.idField.responseKey;
  const items = (isEnvelope ? (body!.data as Record<string, unknown>[]) : []).filter((d) => d && typeof d === 'object');
  const idProblems: string[] = [];
  const notFound = new Set(isEnvelope ? (body!.errors as { error_id?: string; error_code?: string }[]).filter((e) => e.error_code === 'NOT_FOUND').map((e) => e.error_id) : []);
  for (const id of ids) {
    const n = items.filter((d) => d[idKey] === id).length;
    if (n === 0) idProblems.push(notFound.has(id) ? `${id} isn't in your data` : `${id} is missing`);
    else if (n > 1) idProblems.push(`${id} comes back ${n} times`);
  }
  const extra = items.filter((d) => !ids.includes(d[idKey] as string)).length;
  if (extra > 0) idProblems.push(`${extra} item${extra === 1 ? '' : 's'} not asked for (or without "${idKey}")`);
  add('ids_once', `Every id sent comes back once, under "${idKey}"`, isEnvelope && idProblems.length === 0, `${ids.length} id${ids.length === 1 ? '' : 's'}: ${ids.join(', ')}`, isEnvelope ? listed(idProblems) : 'No envelope');

  const fieldProblems: string[] = [];
  for (const item of items) {
    const id = String(item[idKey]);
    for (const field of design.fields) {
      if (!(field.responseKey in item)) {
        fieldProblems.push(`${id}: "${field.responseKey}" is missing (empty value and no default)`);
      } else if (field.typeInContract !== false && !matchesType(field.type, item[field.responseKey])) {
        fieldProblems.push(`${id}: "${field.responseKey}" is ${show(item[field.responseKey])}, the contract says ${field.type}`);
      }
    }
  }
  add('fields_typed', 'Every field is present, with its type', isEnvelope && items.length > 0 && fieldProblems.length === 0, `${design.fields.length} field${design.fields.length === 1 ? '' : 's'} × ${items.length} item${items.length === 1 ? '' : 's'}`, !isEnvelope || items.length === 0 ? 'No items to check' : listed(fieldProblems));
  add('fast', `Answers within ${JIVOX_TIME_LIMIT_MS / 1000} s`, res.durationMs < JIVOX_TIME_LIMIT_MS, `${res.durationMs} ms`, `${res.durationMs} ms`);
  return checks;
}

export function errorText(body: unknown) {
  const first = (body as { errors?: { error_code?: string; error_message?: string }[] } | null)?.errors?.[0];
  return first?.error_message && (body as { status?: string }).status === 'failure' ? `: ${first.error_code}, ${first.error_message}` : '';
}

async function usableToken(apiId: string) {
  const now = new Date();
  const tokens = await prisma.apiToken.findMany({
    where: { apiId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: 'desc' },
  });
  for (const t of tokens) {
    const token = t.tokenEncrypted ? decryptToken(t.tokenEncrypted, t.tokenHash) : null;
    if (token) return { name: t.name, token };
  }
  return tokens.length > 0 ? { name: tokens[0].name, token: null } : null;
}

export const LIVE_TIMEOUT_MS = 10_000;
export async function callLive(sample: Sample, style: 'x_api_key' | 'bearer', token: string | null) {
  const headers: Record<string, string> = { [SELF_CHECK_HEADER.name]: SELF_CHECK_HEADER.value };
  if (token) {
    const [name, value] = tokenHeader(style, token);
    headers[name] = value;
  }
  if (sample.method === 'POST') headers['Content-Type'] = 'application/json';
  const started = performance.now();
  const res = await fetch(sample.url, {
    method: sample.method,
    headers,
    body: sample.method === 'POST' ? JSON.stringify(sample.body) : undefined,
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    redirect: 'manual',
  });
  const text = await res.text();
  const durationMs = Math.round(performance.now() - started);
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON: the envelope check reports it */
  }
  const pick = (name: string) => res.headers.get(name) ?? undefined;
  const responseHeaders = Object.fromEntries(
    [['Cache-Control', pick('cache-control')], ['Content-Type', pick('content-type')]].filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  return { status: res.status, headers: responseHeaders, body, durationMs };
}

export async function selfCheck(api: Api, brandSlug: string, input: TestInput) {
  const ctx = await loadContext(api, brandSlug);
  const ids = input.ids ?? (await defaultIds(ctx));
  const sample = await sampleFor(ctx, ids);
  const checks: Check[] = [];
  const published = ctx.status === 'published';
  checks.push({ id: 'published', label: 'The API is published', status: published ? 'pass' : 'fail', detail: published ? 'Answers on /v1' : 'Publish it: until then /v1 answers 404' });
  const token = await usableToken(api.id);
  checks.push({
    id: 'token',
    label: 'An active token exists',
    status: token?.token ? 'pass' : token ? 'warn' : 'fail',
    detail: token?.token ? `Used for this check: "${token.name}"` : token ? `"${token.name}" is active but can't be read here (other encryption key): renew it to run the live check` : 'Create a token (or extend / renew an expired one)',
  });

  let response: { status: number; headers: Record<string, string>; body: unknown; durationMs: number };
  let mode: 'live' | 'in-app' = 'in-app';
  const why = !published ? 'the API is a draft' : 'no readable active token';
  if (published && token?.token) {
    mode = 'live';
    try {
      response = await callLive(sample, ctx.authHeader, token.token);
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? `no answer within ${LIVE_TIMEOUT_MS / 1000} s` : 'connection failed';
      checks.push({ id: 'reachable', label: `Reachable at ${ctx.url}`, status: 'fail', detail: `${reason}. Check PUBLIC_BASE_URL (now ${env.PUBLIC_BASE_URL}) and that the server / tunnel is running` });
      return { mode, url: ctx.url, ids, passed: false, checks, request: describeRequest(sample), response: null, durationMs: null };
    }
    const host = new URL(env.PUBLIC_BASE_URL).hostname;
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || host.endsWith('.localhost');
    checks.push({
      id: 'reachable',
      label: `Reachable at ${ctx.url}`,
      status: local ? 'warn' : 'pass',
      detail: local
        ? "Answers here, but Jivox on qa3 can't reach localhost. Set PUBLIC_BASE_URL to a public address (a tunnel such as ngrok, or the deployed server)"
        : 'Answered over the network',
    });
    const anonymous = await callLive(sample, ctx.authHeader, null).catch(() => null);
    const refused = anonymous?.status === 401 && (anonymous.body as { status?: string } | null)?.status === 'failure';
    checks.push({ id: 'needs_token', label: 'Refuses calls without a token', status: refused ? 'pass' : 'fail', detail: refused ? 'HTTP 401 with the failure envelope' : `HTTP ${anonymous?.status ?? 'no answer'}: calls without a token must be refused` });
  } else {
    response = await answerInApp(ctx, sample);
    checks.push({ id: 'reachable', label: `Reachable at ${ctx.url}`, status: 'skip', detail: `Not called over the network: ${why}. The checks below ran inside the app` });
    checks.push({ id: 'needs_token', label: 'Refuses calls without a token', status: 'skip', detail: `Checked once the API is published and has an active token` });
  }

  checks.push(...contentChecks(ctx, ids, response));
  return {
    mode,
    url: ctx.url,
    ids,
    // Passed = what Jivox's verification would see: the LIVE call, and no ✗ (⚠ is allowed).
    passed: mode === 'live' && checks.every((c) => c.status !== 'fail'),
    checks,
    request: describeRequest(sample),
    response: { status: response.status, headers: response.headers, body: response.body },
    durationMs: response.durationMs,
  };
}

