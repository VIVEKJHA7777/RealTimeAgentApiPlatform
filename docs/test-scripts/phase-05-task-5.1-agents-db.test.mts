// Task 5.1: Jivox agents storage. Checks the shared secret box (seal / open an access key, bound to its
// row), the database rules on jivox_agents, the composite token link (only a token of the SAME API),
// deletes, a same-name race between two connections, and the corrected product tiers.
// Part 1–3 run inside ONE transaction that is rolled back; part 4 commits its own rows and deletes them.
//   cd backend && npx tsx ../docs/test-scripts/phase-05-task-5.1-agents-db.test.mts
// Uses backend/.env (DATABASE_URL, TOKEN_ENCRYPTION_KEY). Another DB: DB_URL=postgresql://… npx tsx …
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { newApiToken } from '../../backend/src/lib/api-token.ts';
import { openSecret, sealSecret } from '../../backend/src/lib/secret-box.ts';
import { env } from '../../backend/src/config/env.ts';
import { getFeedSchema } from '../../backend/src/modules/jivox/feed-schemas.ts';
const pg = createRequire(new URL('../../backend/package.json', import.meta.url))('pg') as typeof import('pg');

let pass = 0, fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`);
};

// ── 1. Secret box (access keys) ──
console.log('— secret box');
const KEY = 'bWNwLWF1dGgvdGVzdC0wMDAwLWZha2Uta2V5LW5vdC1yZWFs'; // a fake key-shaped string
const sealed = sealSecret(KEY, 'jivox-agent:A1');
eq('open(seal(key)) = key', openSecret(sealed, 'jivox-agent:A1'), KEY);
eq('stored text never contains the key', sealed.includes(KEY.slice(4, 20)), false);
eq('sealing twice gives different text (random IV)', sealSecret(KEY, 'jivox-agent:A1') === sealed, false);
eq('moved to another agent row → null', openSecret(sealed, 'jivox-agent:A2'), null);
const [v, iv, ct, tag] = sealed.split('.');
const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
eq('changed ciphertext / tag / iv → null', [openSecret([v, iv, flip(ct), tag].join('.'), 'jivox-agent:A1'), openSecret([v, iv, ct, flip(tag)].join('.'), 'jivox-agent:A1'), openSecret([v, flip(iv), ct, tag].join('.'), 'jivox-agent:A1')], [null, null, null]);
eq('garbage → null (no throw)', ['x', '', 'v2.a.b.c'].map((s) => openSecret(s, 'jivox-agent:A1')), [null, null, null]);
const childOpen = (key: string) =>
  execFileSync('npx', ['tsx', '-e', `import('${new URL('../../backend/src/lib/secret-box.ts', import.meta.url).pathname}').then(m => console.log(JSON.stringify(m.openSecret(${JSON.stringify(sealed)}, 'jivox-agent:A1'))))`], { env: { ...process.env, TOKEN_ENCRYPTION_KEY: key }, encoding: 'utf8' }).trim();
eq('another TOKEN_ENCRYPTION_KEY → null', childOpen(Buffer.alloc(32, 9).toString('base64')), 'null');
const tok = newApiToken();
eq('API tokens still use the same format (v1.iv.ct.tag) and open', [tok.tokenEncrypted.split('.').length, openSecret(tok.tokenEncrypted, tok.tokenHash)], [4, tok.token]);

// ── 2. Product tiers (corrected from Jivox's live schema, task 5.0) ──
console.log('— tiers');
const product = getFeedSchema('product');
const tier = (n: string) => product.fields.find((f) => f.name === n)?.tier;
eq('mandatory product fields = item_id, product_image, product_name', product.fields.filter((f) => f.tier === 'mandatory').map((f) => f.name).sort(), ['item_id', 'product_image', 'product_name']);
eq('purchase_link_1_* → expected; currency, current_price, description → optional', ['purchase_link_1_purchase_link', 'purchase_link_1_retailer_name', 'currency', 'current_price', 'description'].map(tier), ['expected', 'expected', 'optional', 'optional', 'optional']);
eq('still 43 product fields', product.fields.length, 43);

// ── 3. Database rules (one transaction, rolled back) ──
console.log('— database');
const url = process.env.DB_URL ?? env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query('BEGIN');
const id = (p: string) => `${p}_t51_${Math.random().toString(36).slice(2, 10)}`;
const [userId, orgId, dsId, apiId, api2Id] = [id('u'), id('o'), id('d'), id('a'), id('a')];
await db.query(`INSERT INTO users (id, email, password_hash, updated_at) VALUES ($1, $2, 'x', now())`, [userId, `${userId}@test.com`]);
await db.query(`INSERT INTO organizations (id, owner_id, name, slug, updated_at) VALUES ($1, $2, 'T', $1, now())`, [orgId, userId]);
await db.query(`INSERT INTO data_sources (id, organization_id, name, kind, id_column, updated_at) VALUES ($1, $2, 'D', 'upload', 'sku', now())`, [dsId, orgId]);
for (const [a, slug] of [[apiId, 'api-t51'], [api2Id, 'api2-t51']]) {
  await db.query(`INSERT INTO apis (id, organization_id, data_source_id, name, slug, updated_at) VALUES ($1, $2, $3, 'A', $4, now())`, [a, orgId, dsId, slug]);
}
const addToken = async (api: string) => {
  const t = newApiToken(), tid = id('k');
  await db.query(`INSERT INTO api_tokens (id, api_id, name, token_hash, token_encrypted, hint, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())`, [tid, api, tid, t.tokenHash, t.tokenEncrypted, t.hint]);
  return tid;
};
const [tokA, tokB] = [await addToken(apiId), await addToken(api2Id)];

const tryIt = async (sql: string, params: unknown[]) => {
  await db.query('SAVEPOINT s');
  try {
    await db.query(sql, params);
    await db.query('RELEASE SAVEPOINT s');
    return 'ok';
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT s');
    const err = e as { constraint?: string; code?: string };
    return err.constraint ?? err.code;
  }
};
type Agent = { name?: string; api?: string; brandstore?: string | null; fields?: unknown; token?: string | null; mcp?: string | null; key?: string | null; hint?: string | null; samples?: unknown; info?: unknown; infoAt?: Date | null; error?: string | null };
const agent = (a: Agent = {}) => {
  const aid = id('g');
  return tryIt(
    `INSERT INTO jivox_agents (id, api_id, name, brandstore, fields, token_id, mcp_url, access_key_encrypted, access_key_hint, sample_ids, agent_info, agent_info_at, last_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
    [aid, a.api ?? apiId, a.name ?? `Agent ${aid}`, a.brandstore ?? null, a.fields === undefined ? ['sub_title'] : a.fields, a.token ?? null, a.mcp ?? null,
      a.key === undefined ? null : a.key, a.hint === undefined ? null : a.hint, a.samples === undefined ? [] : a.samples, a.info === undefined ? null : JSON.stringify(a.info), a.infoAt ?? null, a.error ?? null],
  );
};
const goodKey = sealSecret(KEY, 'jivox-agent:x');
eq('a full agent (fields, token of this API, MCP URL, key + hint, samples, info) → saved', await agent({ name: 'axas · Agent 1', brandstore: 'axas-c63e9', fields: ['sub_title', 'currency', 'current_price'], token: tokA, mcp: 'https://brandstore-data-mcp.qa3.jivox.com/mcp', key: goodKey, hint: 'Rm', samples: ['SKU-1001', 'SKU-1002'], info: { feed_type: 'product' }, infoAt: new Date() }), 'ok');
eq('a bare agent (name only, no fields yet) → saved', await agent({ name: 'bare', fields: [] }), 'ok');
eq('same name, other case / spaces, same API → refused', [await agent({ name: 'AXAS · agent 1' }), await agent({ name: '  axas · Agent 1 ' })], ['jivox_agents_api_name_key', 'jivox_agents_api_name_key']);
eq('same name on ANOTHER API → saved', await agent({ name: 'axas · Agent 1', api: api2Id }), 'ok');
eq('blank / 61-char name → refused; 60 → saved', [await agent({ name: '  ' }), await agent({ name: 'x'.repeat(61) }), await agent({ name: 'y'.repeat(60) })], ['jivox_agents_name_len', 'jivox_agents_name_len', 'ok']);
eq('brandstore blank / 101 chars → refused', [await agent({ brandstore: ' ' }), await agent({ brandstore: 'b'.repeat(101) })], ['jivox_agents_brandstore_len', 'jivox_agents_brandstore_len']);
eq('fields: not snake_case / NULL entry / 101 names → refused', [await agent({ fields: ['Sub Title'] }), await agent({ fields: ['sub_title', null] }), await agent({ fields: Array.from({ length: 101 }, (_, i) => `f${i}`) })], ['jivox_agents_fields_list', 'jivox_agents_fields_list', 'jivox_agents_fields_list']);
eq('fields: NULL list → refused; 100 names → saved', [await agent({ fields: null }), await agent({ fields: Array.from({ length: 100 }, (_, i) => `f${i}`) })], ['jivox_agents_fields_list', 'ok']);
eq('sample ids: 11 / NULL entry → refused; 10 → saved', [await agent({ samples: Array.from({ length: 11 }, (_, i) => `S${i}`) }), await agent({ samples: ['a', null] }), await agent({ samples: Array.from({ length: 10 }, (_, i) => `S${i}`) })], ['jivox_agents_sample_ids_list', 'jivox_agents_sample_ids_list', 'ok']);
eq('MCP URL: not http(s) / with a space / 501 chars → refused', [await agent({ mcp: 'ftp://x' }), await agent({ mcp: 'https://a b' }), await agent({ mcp: 'https://' + 'h'.repeat(493) })], ['jivox_agents_mcp_url_format', 'jivox_agents_mcp_url_format', 'jivox_agents_mcp_url_format']);
eq('access key without hint / hint without key → refused', [await agent({ key: goodKey }), await agent({ hint: 'Rm' })], ['jivox_agents_access_key_pair', 'jivox_agents_access_key_pair']);
eq('access key stored in plain text (not v1.…) → refused', await agent({ key: KEY, hint: 'Rm' }), 'jivox_agents_access_key_shape');
eq('agent info without its time / time without info → refused', [await agent({ info: { a: 1 } }), await agent({ infoAt: new Date() })], ['jivox_agents_agent_info_pair', 'jivox_agents_agent_info_pair']);
eq('last error over 1000 chars → refused', await agent({ error: 'e'.repeat(1001) }), 'jivox_agents_last_error_len');
eq('token of ANOTHER API → refused (composite link)', await agent({ token: tokB }), 'jivox_agents_token_id_api_id_fkey');
eq('unknown token / unknown API → refused', [await agent({ token: 'nope' }), await agent({ api: 'nope' })], ['jivox_agents_token_id_api_id_fkey', 'jivox_agents_api_id_fkey']);
eq('moving an agent to another API keeps its token → refused', await tryIt(`UPDATE jivox_agents SET api_id = $1, name = 'moved' WHERE token_id = $2`, [api2Id, tokA]), 'jivox_agents_token_id_api_id_fkey');
eq('revoking the linked token keeps the link (rows stay)', [await tryIt(`UPDATE api_tokens SET revoked_at = now(), token_encrypted = NULL WHERE id = $1`, [tokA]), Number((await db.query(`SELECT count(*) FROM jivox_agents WHERE token_id = $1`, [tokA])).rows[0].count)], ['ok', 1]);
eq('deleting a linked token on its own → refused (tokens only go with their API)', await tryIt(`DELETE FROM api_tokens WHERE id = $1`, [tokA]), 'jivox_agents_token_id_api_id_fkey');
const agents = async (a: string) => Number((await db.query(`SELECT count(*) FROM jivox_agents WHERE api_id = $1`, [a])).rows[0].count);
const before = await agents(apiId);
eq(`deleting the API deletes its agents and tokens in one go (${before} agents)`, [await tryIt(`DELETE FROM apis WHERE id = $1`, [apiId]), await agents(apiId), Number((await db.query(`SELECT count(*) FROM api_tokens WHERE api_id = $1`, [apiId])).rows[0].count)], ['ok', 0, 0]);
eq('the other API keeps its agent', await agents(api2Id), 1);
await db.query('SET LOCAL enable_seqscan = off');
const plan = (await db.query(`EXPLAIN SELECT id FROM jivox_agents WHERE api_id = $1 ORDER BY created_at`, [api2Id])).rows.map((r) => r['QUERY PLAN']).join(' ');
eq('the agent list uses the (api_id, created_at) index', /jivox_agents_api_id_created_at_idx/.test(plan), true);
await db.query('ROLLBACK');
eq('nothing left behind (rolled back)', Number((await db.query(`SELECT count(*) FROM users WHERE id = $1`, [userId])).rows[0].count), 0);

// ── 4. Two people add the same name at the same moment: exactly one wins ──
console.log('— race');
const [u2, o2, d2, a2] = [id('u'), id('o'), id('d'), id('a')];
await db.query(`INSERT INTO users (id, email, password_hash, updated_at) VALUES ($1, $2, 'x', now())`, [u2, `${u2}@test.com`]);
await db.query(`INSERT INTO organizations (id, owner_id, name, slug, updated_at) VALUES ($1, $2, 'T', $1, now())`, [o2, u2]);
await db.query(`INSERT INTO data_sources (id, organization_id, name, kind, id_column, updated_at) VALUES ($1, $2, 'D', 'upload', 'sku', now())`, [d2, o2]);
await db.query(`INSERT INTO apis (id, organization_id, data_source_id, name, slug, updated_at) VALUES ($1, $2, $3, 'A', 'race-t51', now())`, [a2, o2, d2]);
const [c1, c2] = [new pg.Client({ connectionString: url }), new pg.Client({ connectionString: url })];
await Promise.all([c1.connect(), c2.connect()]);
try {
  await c1.query('BEGIN');
  await c2.query('BEGIN');
  await c1.query(`INSERT INTO jivox_agents (id, api_id, name, updated_at) VALUES ($1, $2, 'Agent 1', now())`, [id('g'), a2]);
  // c2 waits for c1 (same unique key); c1 commits; c2 must then be refused.
  const second = c2.query(`INSERT INTO jivox_agents (id, api_id, name, updated_at) VALUES ($1, $2, 'agent 1 ', now())`, [id('g'), a2]).then(() => 'ok', (e: { constraint?: string }) => e.constraint);
  await new Promise((r) => setTimeout(r, 300));
  await c1.query('COMMIT');
  eq('second insert (waited for the first) → refused by the unique name', await second, 'jivox_agents_api_name_key');
  await c2.query('ROLLBACK');
  eq('exactly one "Agent 1"', Number((await db.query(`SELECT count(*) FROM jivox_agents WHERE api_id = $1`, [a2])).rows[0].count), 1);
} finally {
  await Promise.all([c1.end(), c2.end()]);
  await db.query(`DELETE FROM users WHERE id = $1`, [u2]); // cascades: brand, data source, API, agent
  eq('race test rows deleted', Number((await db.query(`SELECT count(*) FROM jivox_agents WHERE api_id = $1`, [a2])).rows[0].count), 0);
  await db.end();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
