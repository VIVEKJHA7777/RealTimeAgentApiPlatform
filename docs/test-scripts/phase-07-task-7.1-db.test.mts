// Task 7.1: storage of the call log + test switches.
//   1. api_call_logs rules (rolled back): kinds, shape, NO secret headers, sizes, lists, numbers
//   2. api_test_switches rules (rolled back): kinds, options per kind, one per kind, a token of THIS API,
//      ends within 24 h, cascades
//   3. writing + trimming (real rows, deleted after): 1 200 rows → the newest 500 kept per API, another
//      API untouched; speed on a 50 000-row log; the (api_id, id DESC) index used
//   cd backend && npx tsx ../docs/test-scripts/phase-07-task-7.1-db.test.mts
import { createRequire } from 'node:module';
import { env } from '../../backend/src/config/env.ts';
import { newApiToken } from '../../backend/src/lib/api-token.ts';
import { prisma } from '../../backend/src/lib/prisma.ts';
import { CALL_LOG_KEPT, trimCallLogs, writeCallLogs } from '../../backend/src/modules/v1/call-log-store.ts';
const pg = createRequire(new URL('../../backend/package.json', import.meta.url))('pg') as typeof import('pg');

let pass = 0, fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`);
};
const db = new pg.Client({ connectionString: process.env.DB_URL ?? env.DATABASE_URL });
await db.connect();
const id = (p: string) => `${p}_t71_${Math.random().toString(36).slice(2, 10)}`;
async function makeApis(n: number) {
  const [u, o, d] = [id('u'), id('o'), id('d')];
  await db.query(`INSERT INTO users (id, email, password_hash, updated_at) VALUES ($1, $2, 'x', now())`, [u, `${u}@test.com`]);
  await db.query(`INSERT INTO organizations (id, owner_id, name, slug, updated_at) VALUES ($1, $2, 'T', $1, now())`, [o, u]);
  await db.query(`INSERT INTO data_sources (id, organization_id, name, kind, id_column, updated_at) VALUES ($1, $2, 'D', 'upload', 'sku', now())`, [d, o]);
  const apis: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = id('a');
    await db.query(`INSERT INTO apis (id, organization_id, data_source_id, name, slug, updated_at) VALUES ($1, $2, $3, 'A', $4, now())`, [a, o, d, `t71-${a.slice(-8)}`]);
    apis.push(a);
  }
  return { user: u, org: o, apis };
}
const tryIt = async (sql: string, params: unknown[]) => {
  await db.query('SAVEPOINT s');
  try { await db.query(sql, params); await db.query('RELEASE SAVEPOINT s'); return 'ok'; }
  catch (e) { await db.query('ROLLBACK TO SAVEPOINT s'); return (e as { constraint?: string; code?: string }).constraint ?? (e as { code?: string }).code; }
};

// ── 1. call log rules ──
console.log('— call log rules');
await db.query('BEGIN');
const t = await makeApis(2);
const [A1, A2] = t.apis;
type L = Partial<{ api: string; kind: string; method: string | null; path: string | null; event: unknown; rh: unknown; body: string; rbody: string; ua: string; ids: unknown; codes: unknown; sw: unknown; status: number; dur: number; tk: string; hdr: string; bytes: number }>;
const log = (l: L = {}) => tryIt(
  `INSERT INTO api_call_logs (api_id, kind, at, method, path, event, request_headers, body, response_body, user_agent, ids, error_codes, switches, status, duration_ms, token_kind, header, body_bytes)
   VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
  [l.api ?? A1, l.kind ?? 'call', l.method === undefined ? 'GET' : l.method, l.path === undefined ? '/v1/b/a?ids=1' : l.path, l.event === undefined ? null : JSON.stringify(l.event),
    l.rh === undefined ? JSON.stringify({ 'user-agent': 'python-httpx/0.28.1', accept: '*/*' }) : JSON.stringify(l.rh), l.body ?? null, l.rbody ?? null, l.ua ?? null,
    l.ids === undefined ? ['SKU-1'] : l.ids, l.codes === undefined ? [] : l.codes, l.sw === undefined ? [] : l.sw, l.status ?? 200, l.dur ?? 12.5, l.tk ?? 'this_api', l.hdr ?? 'x_api_key', l.bytes ?? 0],
);
eq('a call (headers without secrets, ids, our status, switches) → saved', await log({ sw: ['no_store', 'slow'] }), 'ok');
eq('a switch line (event, no request) → saved', await log({ kind: 'switch', method: null, path: null, event: { action: 'on', switch: 'slow' }, rh: null, ids: [] }), 'ok');
eq('unknown kind / a call without method or path / a switch line without event → refused', [await log({ kind: 'note' }), await log({ method: null }), await log({ kind: 'switch', method: null, path: null })], ['api_call_logs_kind', 'api_call_logs_shape', 'api_call_logs_shape']);
eq('a request header authorization / x-api-key / cookie (any of them) → refused', [await log({ rh: { authorization: 'Bearer x' } }), await log({ rh: { 'x-api-key': 'k' } }), await log({ rh: { cookie: 'sid=1' } })], ['api_call_logs_no_secret_headers', 'api_call_logs_no_secret_headers', 'api_call_logs_no_secret_headers']);
eq('body / response body over 4 KB, UA over 300, negative body size → refused; exactly 4 KB fine', [await log({ body: 'b'.repeat(4097) }), await log({ rbody: 'r'.repeat(4097) }), await log({ ua: 'u'.repeat(301) }), await log({ bytes: -1 }), await log({ body: 'b'.repeat(4096) })], ['api_call_logs_sizes', 'api_call_logs_sizes', 'api_call_logs_sizes', 'api_call_logs_sizes', 'ok']);
eq('101 ids / a NULL id / an unknown switch name → refused', [await log({ ids: Array.from({ length: 101 }, (_, i) => `S${i}`) }), await log({ ids: ['a', null] }), await log({ sw: ['explode'] })], ['api_call_logs_lists', 'api_call_logs_lists', 'api_call_logs_lists']);
eq('status 99 / 600, negative duration → refused', [await log({ status: 99 }), await log({ status: 600 }), await log({ dur: -1 })], ['api_call_logs_numbers', 'api_call_logs_numbers', 'api_call_logs_numbers']);
eq('unknown token kind / header style → refused', [await log({ tk: 'stolen' }), await log({ hdr: 'basic' })], ['api_call_logs_token_kind', 'api_call_logs_header']);

// ── 2. switch rules ──
console.log('— switch rules');
const tok = async (api: string) => {
  const k = newApiToken(), tid = id('k');
  await db.query(`INSERT INTO api_tokens (id, api_id, name, token_hash, token_encrypted, hint, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())`, [tid, api, tid, k.tokenHash, k.tokenEncrypted, k.hint]);
  return tid;
};
const [TK1, TK2] = [await tok(A1), await tok(A2)];
type W = Partial<{ api: string; kind: string; options: unknown; token: string | null; ends: string; by: string | null }>;
const sw = (w: W = {}) => tryIt(
  `INSERT INTO api_test_switches (id, api_id, kind, options, token_id, ends_at, created_by_id, updated_at) VALUES ($1, $2, $3, $4, $5, now() + $6::interval, $7, now())`,
  [id('w'), w.api ?? A1, w.kind ?? 'no_store', JSON.stringify(w.options ?? {}), w.token === undefined ? null : w.token, w.ends ?? '1 hour', w.by === undefined ? t.user : w.by],
);
eq('no_store for the whole API, 1 h → saved', await sw(), 'ok');
eq('the same kind twice on one API → refused (one per kind)', await sw(), 'api_test_switches_api_id_kind_key');
eq('scoped to one token of THIS API → saved; another API\'s token → refused', [await sw({ kind: 'status_failure', token: TK1 }), await sw({ kind: 'empty_data', token: TK2 })], ['ok', 'api_test_switches_token_id_api_id_fkey']);
eq('unknown kind → refused', await sw({ kind: 'explode' }), 'api_test_switches_kind');
eq('wrong_type: needs a field (1–100 chars)', [await sw({ kind: 'wrong_type' }), await sw({ kind: 'wrong_type', options: { field: '' } }), await sw({ kind: 'wrong_type', options: { field: 'current_price' } })], ['api_test_switches_options', 'api_test_switches_options', 'ok']);
eq('slow: 1–30 000 ms, a number', [await sw({ kind: 'slow', options: { ms: 0 } }), await sw({ kind: 'slow', options: { ms: 30001 } }), await sw({ kind: 'slow', options: { ms: '3500' } }), await sw({ kind: 'slow', options: { ms: 3500 } })], ['api_test_switches_options', 'api_test_switches_options', 'api_test_switches_options', 'ok']);
eq('http_status: one of 400/401/403/404/429/500/502/503', [await sw({ kind: 'http_status', options: { status: 418 } }), await sw({ kind: 'http_status', options: { status: 500 } })], ['api_test_switches_options', 'ok']);
eq('the other kinds take no options', [await sw({ kind: 'drop_id', options: { x: 1 } }), await sw({ kind: 'drop_id' })], ['api_test_switches_options', 'ok']);
eq('ends in the past / more than 24 h ahead → refused; exactly 24 h fine', [await sw({ kind: 'extra_id', ends: '-1 minute' }), await sw({ kind: 'extra_id', ends: '25 hours' }), await sw({ kind: 'extra_id', ends: '24 hours' })], ['api_test_switches_ends', 'api_test_switches_ends', 'ok']);
eq('revoking the scoped token keeps the switch; deleting it alone → refused (tokens go with their API)', [await tryIt(`UPDATE api_tokens SET revoked_at = now(), token_encrypted = NULL WHERE id = $1`, [TK1]), await tryIt(`DELETE FROM api_tokens WHERE id = $1`, [TK1])], ['ok', 'api_test_switches_token_id_api_id_fkey']);
const count = async (table: string, api: string) => Number((await db.query(`SELECT count(*) FROM ${table} WHERE api_id = $1`, [api])).rows[0].count);
const before = [await count('api_call_logs', A1), await count('api_test_switches', A1)];
eq(`deleting the API removes its log (${before[0]}) and switches (${before[1]}) in one go`, [await tryIt(`DELETE FROM apis WHERE id = $1`, [A1]), await count('api_call_logs', A1), await count('api_test_switches', A1)], ['ok', 0, 0]);
const helper = id('u');
await db.query(`INSERT INTO users (id, email, password_hash, updated_at) VALUES ($1, $2, 'x', now())`, [helper, `${helper}@test.com`]);
await sw({ api: A2, kind: 'not_json', by: helper });
eq('deleting the user who set a switch keeps it ("set by" empty)', [await tryIt(`DELETE FROM users WHERE id = $1`, [helper]), Number((await db.query(`SELECT count(*) FROM api_test_switches WHERE api_id = $1 AND kind = 'not_json' AND created_by_id IS NULL`, [A2])).rows[0].count)], ['ok', 1]);
await db.query('ROLLBACK');

// ── 3. writing + trimming (real rows) ──
console.log('— writing + trimming');
const r = await makeApis(2);
const [B1, B2] = r.apis;
const row = (api: string, i: number) => ({ apiId: api, at: new Date(), method: 'GET', path: `/v1/b/a?ids=S${i}`, ids: [`S${i}`], idCount: 1, status: 200, durationMs: 3, tokenKind: 'this_api', tokenName: 'Jivox axas', responseHeaders: { 'cache-control': 'no-store' } });
let written = 0;
for (let b = 0; b < 12; b++) written += await writeCallLogs(Array.from({ length: 100 }, (_, i) => row(B1, b * 100 + i)));
await writeCallLogs(Array.from({ length: 30 }, (_, i) => row(B2, i)));
const newest = (await db.query(`SELECT path FROM api_call_logs WHERE api_id = $1 ORDER BY id DESC LIMIT 1`, [B1])).rows[0].path;
const oldest = (await db.query(`SELECT path FROM api_call_logs WHERE api_id = $1 ORDER BY id ASC LIMIT 1`, [B1])).rows[0].path;
eq(`1 200 written in batches of 100 → the newest ${CALL_LOG_KEPT} kept (S700…S1199); the other API's 30 untouched`, [written, await count('api_call_logs', B1), oldest, newest, await count('api_call_logs', B2)], [1200, 500, '/v1/b/a?ids=S700', '/v1/b/a?ids=S1199', 30]);
eq('trimming again changes nothing; trimming to 10 keeps the newest 10', [await trimCallLogs(B1), await trimCallLogs(B1, 10), await count('api_call_logs', B1)], [0, 490, 10]);
await db.query(`INSERT INTO api_call_logs (api_id, at, method, path, ids, status) SELECT $1, now(), 'GET', '/v1/x?ids=' || g, ARRAY['S' || g], 200 FROM generate_series(1, 50000) g`, [B2]);
let t0 = Date.now();
const trimmed = await trimCallLogs(B2);
const trimMs = Date.now() - t0;
eq(`a 50 030-row log trimmed to 500 in one statement (${trimMs} ms, < 1 500)`, [trimmed, await count('api_call_logs', B2), trimMs < 1500], [49530, 500, true]);
await db.query(`INSERT INTO api_call_logs (api_id, at, method, path, ids, status) SELECT $1, now(), 'GET', '/v1/x', ARRAY[]::text[], 200 FROM generate_series(1, 20000) g`, [B2]);
await db.query('ANALYZE api_call_logs');
t0 = Date.now();
await writeCallLogs(Array.from({ length: 100 }, (_, i) => row(B2, i)));
const batchMs = Date.now() - t0;
eq(`a batch of 100 + the trim on a 20 500-row log (${batchMs} ms, < 1 500)`, [await count('api_call_logs', B2), batchMs < 1500], [500, true]);
await db.query('SET enable_seqscan = off'); // a small table may be scanned whole; we want to see the index CAN serve it
const plan = (await db.query(`EXPLAIN SELECT id FROM api_call_logs WHERE api_id = $1 ORDER BY id DESC LIMIT 50`, [B1])).rows.map((x) => x['QUERY PLAN']).join(' ');
eq('the newest-first list uses the (api_id, id DESC) index', /api_call_logs_api_id_id_idx/.test(plan), true);
await db.query('RESET enable_seqscan');

await db.query(`DELETE FROM organizations WHERE owner_id = $1`, [r.user]);
await db.query(`DELETE FROM users WHERE id = $1`, [r.user]);
eq('nothing left behind', [await count('api_call_logs', B1), await count('api_call_logs', B2)], [0, 0]);
await db.end();
await prisma.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
