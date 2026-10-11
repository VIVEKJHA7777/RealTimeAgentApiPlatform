// Task 4.8: load + race tests for the live API (/v1) on 500 000 rows.
//   A. Load: hundreds of calls at once, a sustained run, timings (p50 / p95 / max), last_used_at writes
//   B. Tokens changing while calls are in flight: revoke, expiry, renew, header style switch
//   C. Data replaced during calls (USD file → EUR file): every answer all-old or all-new, never mixed
//   D. Design saved during calls: every answer all-old-shape or all-new-shape
//   E. Publish / unpublish racing calls; F. the API deleted during calls
// Rule checked everywhere: never a 500, every answer is the contract envelope with no-store, and a
// call STARTED after a change finished always sees the change.
//
// Needs (once):  python3 docs/test-data/generate-big-csv.py 500000 /tmp/products-500k.csv
//                sed 's/,USD,/,EUR,/' /tmp/products-500k.csv > /tmp/products-500k-eur.csv
// Run (backend running), from the backend folder:
//   npx tsx ../docs/test-scripts/phase-04-task-4.8-load-and-races.mts
//   API=http://localhost:4001 DB_URL=postgresql://…/api_platform_mine npx tsx ../docs/test-scripts/…   (your copy)
// Creates its own test user and deletes ONLY it at the end.
import { execFileSync } from 'node:child_process';
import { existsSync, openAsBlob } from 'node:fs';
import { performance } from 'node:perf_hooks';

const BASE = (process.env.API ?? 'http://localhost:4000').replace(/\/api\/?$/, '').replace(/\/$/, '');
const DB = process.env.DB_URL ?? 'postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev';
const USD = '/tmp/products-500k.csv';
const EUR = '/tmp/products-500k-eur.csv';
for (const f of [USD, EUR]) if (!existsSync(f)) { console.error(`Missing ${f} (see the top of this script)`); process.exit(1); }

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✔' : '✘'} ${name}${ok ? '' : `  (${detail})`}`); };
const sql = (q: string) => execFileSync('psql', [DB, '-tAc', q], { encoding: 'utf8' }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]); };

// ── the app's own API (logged in) ──
let cookie = '';
async function app(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function waitImport(slug: string, ds: string, imp: string) {
  for (let i = 0; i < 600; i++) {
    const r = await app('GET', `/organizations/${slug}/data-sources/${ds}/imports/${imp}`);
    if (['succeeded', 'failed'].includes(r.body.import.status)) return r.body.import.status as string;
    await sleep(250);
  }
  return 'timeout';
}

// ── one /v1 call, timed ──
type Call = { start: number; end: number; status: number; code: string; cache: string; body: any };
const T0 = performance.now();
const now = () => performance.now() - T0;
async function call(path: string, header: [string, string] | null): Promise<Call> {
  const start = now();
  try {
    const res = await fetch(`${BASE}/v1/${path}`, { headers: header ? { [header[0]]: header[1] } : {} });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON: counted as a bad envelope */ }
    return { start, end: now(), status: res.status, code: body?.errors?.[0]?.error_code ?? (res.ok ? 'ok' : '?'), cache: res.headers.get('cache-control') ?? '', body };
  } catch (err) {
    return { start, end: now(), status: 0, code: `NETWORK ${(err as Error).message}`, cache: '', body: null };
  }
}
const isEnvelope = (c: Call) => c.body && typeof c.body.status === 'string' && typeof c.body.generated_at === 'string' && Array.isArray(c.body.data) && Array.isArray(c.body.errors);
// Calls fired continuously by `workers` loops until stop() — for "while something happens" tests.
function stream(workers: number, make: () => Promise<Call>) {
  const calls: Call[] = [];
  let running = true;
  const loops = Array.from({ length: workers }, async () => { while (running) calls.push(await make()); });
  return { calls, stop: async () => { running = false; await Promise.all(loops); return calls; } };
}
const healthy = (calls: Call[]) => calls.every((c) => c.status !== 0 && c.status < 500 && isEnvelope(c) && /no-store/.test(c.cache));
const statusMix = (calls: Call[]) => Object.entries(calls.reduce<Record<string, number>>((m, c) => ((m[`${c.status} ${c.code}`] = (m[`${c.status} ${c.code}`] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(', ');

// ═════════════════════ setup ═════════════════════
const email = `load-${Date.now()}@test.com`;
console.log('Setup: account, brand, 500 000 rows, design, token, publish');
await app('POST', '/auth/signup', { email, password: 'password123' });
const S = (await app('POST', '/organizations', { name: 'Load Test', slug: 'load-test' })).body.organization.slug as string;
const form = new FormData();
form.append('file', await openAsBlob(USD), 'products-500k.csv');
form.append('idColumn', 'sku');
form.append('name', 'Big');
const created = await app('POST', `/organizations/${S}/data-sources`, form);
const DS = created.body.dataSource.id as string;
const t1 = performance.now();
check('500 000 rows imported', (await waitImport(S, DS, created.body.import.id)) === 'succeeded');
console.log(`    (import took ${((performance.now() - t1) / 1000).toFixed(1)} s)`);
await app('POST', `/organizations/${S}/apis`, { name: 'Prices', slug: 'prices', dataSourceId: DS });
const DESIGN_V1 = {
  idField: { responseKey: 'sku' },
  fields: [
    { jivoxColumn: 'product_name', sourceColumn: 'name', responseKey: 'name', type: 'string' },
    { jivoxColumn: 'current_price', sourceColumn: 'price', responseKey: 'price', type: 'float' },
    { jivoxColumn: 'currency', sourceColumn: 'currency', responseKey: 'currency', type: 'string' },
  ],
  request: { method: 'GET', query: { ids: '{item_id}' }, maxIdsPerCall: 100 },
};
const saved = await app('PUT', `/organizations/${S}/apis/prices/design`, { version: 0, ...DESIGN_V1 });
check('design saved', saved.status === 200, JSON.stringify(saved.body).slice(0, 200));
const tk = await app('POST', `/organizations/${S}/apis/prices/tokens`, { name: 'Load' });
let TOKEN = tk.body.token as string;
let TOKEN_ID = tk.body.tokenInfo.id as string;
check('published', (await app('POST', `/organizations/${S}/apis/prices/publish`)).body.api.status === 'published');
const P = `${S}/prices`;
const sku = (n: number) => `SKU-${String(n).padStart(7, '0')}`;
// 100 ids spread over the whole file
const IDS100 = Array.from({ length: 100 }, (_, i) => sku(1 + i * 4999));
const Q100 = `${P}?ids=${IDS100.join(',')}`;
const KEY = (t = TOKEN): [string, string] => ['X-Api-Key', t];

// ═════════════════════ A. load ═════════════════════
console.log('A. Load');
await call(Q100, KEY()); // warm-up
for (const n of [100, 300, 500]) {
  const t = now();
  const calls = await Promise.all(Array.from({ length: n }, () => call(Q100, KEY())));
  const wall = Math.round(now() - t);
  const lat = calls.map((c) => c.end - c.start);
  const allRight = calls.every((c) => c.status === 200 && c.body.data.length === 100 && c.body.errors.length === 0);
  check(`${n} calls at once (100 ids each) → all 200 with 100 items`, allRight, statusMix(calls));
  console.log(`    wall ${wall} ms · per call p50 ${pct(lat, 50)} ms, p95 ${pct(lat, 95)} ms, max ${pct(lat, 100)} ms`);
  if (n === 300) check('  300 at once: every call under Jivox\'s 3 s', pct(lat, 100) < 3000, `max ${pct(lat, 100)} ms`);
}
{
  const updBefore = Number(sql(`SELECT n_tup_upd FROM pg_stat_user_tables WHERE relname = 'api_tokens'`));
  const t = now();
  const s = stream(50, () => call(Q100, KEY()));
  await sleep(10_000);
  const calls = await s.stop();
  const secs = (now() - t) / 1000;
  const lat = calls.map((c) => c.end - c.start);
  check(`sustained: 50 callers for 10 s → ${calls.length} calls, all 200`, calls.every((c) => c.status === 200), statusMix(calls));
  console.log(`    ${Math.round(calls.length / secs)} calls/s (each 100 ids = ${Math.round((calls.length * 100) / secs)} items/s) · p50 ${pct(lat, 50)} ms, p95 ${pct(lat, 95)} ms, max ${pct(lat, 100)} ms`);
  await sleep(1500); // stats are flushed about once a second
  const writes = Number(sql(`SELECT n_tup_upd FROM pg_stat_user_tables WHERE relname = 'api_tokens'`)) - updBefore;
  check(`  last_used_at: at most 1 write a minute (${writes} token-row writes for ${calls.length} calls)`, writes <= 1, `${writes}`);
  check('  last_used_at is set', sql(`SELECT last_used_at IS NOT NULL FROM api_tokens WHERE id = '${TOKEN_ID}'`) === 't');
}
{
  const bad = Array.from({ length: 200 }, (_, i) => call(Q100, KEY(i % 2 ? 'rtk_' + 'x'.repeat(43) : 'nope')));
  const good = Array.from({ length: 100 }, () => call(Q100, KEY()));
  const [b, g] = await Promise.all([Promise.all(bad), Promise.all(good)]);
  check('200 bad-token calls mixed with 100 good ones → bad 401, good 200', b.every((c) => c.status === 401) && g.every((c) => c.status === 200), `${statusMix(b)} | ${statusMix(g)}`);
}
check('the app still answers after the load (health ok)', (await app('GET', '/health')).body.status === 'ok');

// ═════════════════════ B. tokens changing mid-flight ═════════════════════
console.log('B. Tokens changing while calls are in flight');
async function duringChange(label: string, header: () => [string, string], change: () => Promise<void>, expectAfter: (c: Call) => boolean, expectBefore = (c: Call) => c.status === 200) {
  const s = stream(20, () => call(`${P}?ids=${sku(1)},${sku(250000)}`, header()));
  await sleep(700);
  const changeStart = now();
  await change();
  const changeEnd = now();
  await sleep(700);
  const calls = await s.stop();
  const before = calls.filter((c) => c.end < changeStart);
  const after = calls.filter((c) => c.start > changeEnd);
  const during = calls.filter((c) => !before.includes(c) && !after.includes(c));
  check(`${label}: ${calls.length} calls, never a 500, all envelopes + no-store`, healthy(calls), statusMix(calls));
  check(`  finished before the change → as before (${before.length})`, before.length > 0 && before.every(expectBefore), statusMix(before));
  check(`  started after it → all see it (${after.length})`, after.length > 0 && after.every(expectAfter), statusMix(after));
  console.log(`    in flight during the change (${during.length}): ${statusMix(during) || 'none'}`);
}
const tk2 = await app('POST', `/organizations/${S}/apis/prices/tokens`, { name: 'To revoke' });
await duringChange('revoke', () => KEY(tk2.body.token), async () => { await app('DELETE', `/organizations/${S}/apis/prices/tokens/${tk2.body.tokenInfo.id}`); }, (c) => c.status === 401 && c.code === 'UNAUTHORIZED');
const tk3 = await app('POST', `/organizations/${S}/apis/prices/tokens`, { name: 'To expire', expiresAt: new Date(Date.now() + 60_000).toISOString() });
{
  // Expiry is a moment, not a request: move it to 1.2 s from now and watch it pass.
  sql(`UPDATE api_tokens SET expires_at = now() + interval '1200 milliseconds' WHERE id = '${tk3.body.tokenInfo.id}'`);
  const expiresAt = now() + 1200;
  const s = stream(20, () => call(`${P}?ids=${sku(1)}`, KEY(tk3.body.token)));
  await sleep(2500);
  const calls = await s.stop();
  const early = calls.filter((c) => c.end < expiresAt - 50);
  const late = calls.filter((c) => c.start > expiresAt + 50);
  check(`expiry passing mid-stream: ${calls.length} calls, never a 500`, healthy(calls), statusMix(calls));
  check(`  answered before the moment → 200 (${early.length})`, early.length > 0 && early.every((c) => c.status === 200), statusMix(early));
  check(`  started after it → 401 TOKEN_EXPIRED (${late.length})`, late.length > 0 && late.every((c) => c.status === 401 && c.code === 'TOKEN_EXPIRED'), statusMix(late));
}
{
  let fresh = '';
  await duringChange('renew (old token)', () => KEY(TOKEN), async () => {
    const r = await app('POST', `/organizations/${S}/apis/prices/tokens/${TOKEN_ID}/renew`, {});
    fresh = r.body.token; TOKEN_ID = r.body.tokenInfo.id;
  }, (c) => c.status === 401);
  const c = await call(Q100, KEY(fresh));
  check('  the new token works at once', c.status === 200);
  TOKEN = fresh;
}
await duringChange('header switched to Bearer (calls keep sending X-Api-Key)', () => KEY(), async () => { await app('PUT', `/organizations/${S}/apis/prices/auth-header`, { style: 'bearer' }); }, (c) => c.status === 401 && /Authorization: Bearer/.test(c.body.errors[0].error_message));
await app('PUT', `/organizations/${S}/apis/prices/auth-header`, { style: 'x-api-key' });

// ═════════════════════ C. data replaced during calls ═════════════════════
console.log('C. Data replaced during calls (500 000 rows, USD → EUR)');
{
  const s = stream(20, () => call(Q100, KEY()));
  await sleep(500);
  const up = new FormData();
  up.append('file', await openAsBlob(EUR), 'products-500k-eur.csv');
  up.append('mode', 'replace');
  const imp = await app('POST', `/organizations/${S}/data-sources/${DS}/imports`, up);
  const status = await waitImport(S, DS, imp.body.import.id);
  const switchedAt = now();
  await sleep(1500);
  const calls = await s.stop();
  const currencies = (c: Call) => [...new Set(c.body?.data?.map((d: any) => d.currency))].join('+');
  const mixed = calls.filter((c) => c.status === 200 && currencies(c).includes('+'));
  const incomplete = calls.filter((c) => c.status === 200 && (c.body.data.length !== 100 || c.body.errors.length));
  const afterSwitch = calls.filter((c) => c.start > switchedAt + 100);
  check(`replace import ${status} while ${calls.length} calls ran; never a 500`, status === 'succeeded' && healthy(calls), statusMix(calls));
  check('  no answer mixes old and new rows (each all USD or all EUR)', mixed.length === 0, `${mixed.length} mixed`);
  check('  no answer misses a row (ids exist in both versions: always 100 items, no NOT_FOUND)', incomplete.length === 0, `${incomplete.length} incomplete`);
  check(`  calls started after the switch → all EUR (${afterSwitch.length})`, afterSwitch.length > 0 && afterSwitch.every((c) => currencies(c) === 'EUR'), [...new Set(afterSwitch.map(currencies))].join(','));
  console.log(`    answers seen: ${Object.entries(calls.reduce<Record<string, number>>((m, c) => ((m[currencies(c)] = (m[currencies(c)] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(', ')}`);
}

// ═════════════════════ D. design saved during calls ═════════════════════
console.log('D. Design saved during calls');
{
  const shape = (c: Call) => (c.status === 200 ? [...new Set(c.body.data.map((d: any) => Object.keys(d).join(',')))].join(' | ') : `${c.status}`);
  const OLD = 'sku,name,price,currency';
  const NEW = 'productId,title,amount';
  const s = stream(20, () => call(Q100, KEY()));
  await sleep(600);
  const v = (await app('GET', `/organizations/${S}/apis/prices/design`)).body.design.version;
  const start = now();
  const r = await app('PUT', `/organizations/${S}/apis/prices/design`, {
    version: v,
    idField: { responseKey: 'productId' },
    fields: [
      { jivoxColumn: 'product_name', sourceColumn: 'name', responseKey: 'title', type: 'string' },
      { jivoxColumn: 'current_price', sourceColumn: 'price', responseKey: 'amount', type: 'float' },
    ],
    request: DESIGN_V1.request,
  });
  const end = now();
  await sleep(800);
  const calls = await s.stop();
  check(`design saved (${r.status}) during ${calls.length} calls; never a 500`, r.status === 200 && healthy(calls), statusMix(calls));
  check('  every answer is entirely the old or entirely the new shape', calls.every((c) => [OLD, NEW].includes(shape(c))), [...new Set(calls.map(shape))].join(' / '));
  check('  calls started after the save → new shape', calls.filter((c) => c.start > end).every((c) => shape(c) === NEW));
  check('  calls finished before it → old shape', calls.filter((c) => c.end < start).every((c) => shape(c) === OLD));
}

// ═════════════════════ E. publish / unpublish racing calls ═════════════════════
console.log('E. Publish / unpublish racing calls');
{
  const s = stream(20, () => call(Q100, KEY()));
  const toggles: { action: string; start: number; end: number; status: number }[] = [];
  for (let i = 0; i < 10; i++) {
    for (const action of ['unpublish', 'publish']) {
      const start = now();
      const r = await app('POST', `/organizations/${S}/apis/prices/${action}`);
      toggles.push({ action, start, end: now(), status: r.status });
      await sleep(60);
    }
  }
  const endAll = now();
  await sleep(500);
  const calls = await s.stop();
  check(`10 × unpublish + publish during ${calls.length} calls: only 200 / 404, never a 500`, healthy(calls) && calls.every((c) => c.status === 200 || (c.status === 404 && c.code === 'NOT_FOUND')), statusMix(calls));
  check('  every toggle answered 200', toggles.every((t) => t.status === 200), toggles.map((t) => t.status).join(','));
  // A call that ran entirely inside a "published" window must be 200; inside an "unpublished" window, 404.
  const windows = toggles.map((t, i) => ({ state: t.action === 'publish' ? 'published' : 'draft', from: t.end, to: toggles[i + 1]?.start ?? endAll + 1e9 }));
  const wrong = calls.filter((c) => {
    const w = windows.find((x) => c.start > x.from && c.end < x.to);
    return w && (w.state === 'published' ? c.status !== 200 : c.status !== 404);
  });
  check('  calls fully inside a published window → 200, inside an unpublished one → 404', wrong.length === 0, `${wrong.length} wrong`);
  check('  ends published: a new call → 200', (await call(Q100, KEY())).status === 200);
}

// ═════════════════════ F. the API deleted during calls ═════════════════════
console.log('F. The API deleted during calls');
{
  const s = stream(20, () => call(Q100, KEY()));
  await sleep(500);
  const del = await app('DELETE', `/organizations/${S}/apis/prices`);
  const end = now();
  await sleep(600);
  const calls = await s.stop();
  check(`deleted (${del.status}) during ${calls.length} calls; never a 500`, del.status === 204 && healthy(calls), statusMix(calls));
  check('  calls started after → 401 (its tokens went with it)', calls.filter((c) => c.start > end).every((c) => c.status === 401));
  check('  the data source stays (500 000 rows, EUR)', sql(`SELECT row_count FROM data_sources WHERE id = '${DS}'`) === '500000');
}

check('the app is healthy at the end', (await app('GET', '/health')).body.status === 'ok');
sql(`DELETE FROM users WHERE email = '${email}'`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
