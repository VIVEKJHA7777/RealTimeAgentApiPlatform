// Task 4.1: API token storage. Checks the token helpers (make, hash, encrypt / decrypt), the
// database safety rules on api_tokens / apis, and the new .env settings.
// Everything runs inside ONE transaction that is rolled back: nothing is left in the database.
//   cd backend && npx tsx ../docs/test-scripts/phase-04-task-4.1-tokens-db.test.mts
// Uses backend/.env (DATABASE_URL, TOKEN_ENCRYPTION_KEY). Another DB: DB_URL=postgresql://… npx tsx …
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { decryptToken, encryptToken, generateApiToken, hashApiToken, newApiToken, tokenHint, tokenState, TOKEN_PATTERN } from '../../backend/src/lib/api-token.ts';
import { env } from '../../backend/src/config/env.ts';
// pg lives in backend/node_modules (this file is outside the backend folder).
const pg = createRequire(new URL('../../backend/package.json', import.meta.url))('pg') as typeof import('pg');

let pass = 0, fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`);
};

// ── 1. Token helpers ──
console.log('— helpers');
const many = Array.from({ length: 2000 }, generateApiToken);
eq('format rtk_ + 43 base64url chars (2000 tokens)', many.every((t) => TOKEN_PATTERN.test(t)), true);
eq('2000 tokens all different', new Set(many).size, 2000);
const t = newApiToken();
eq('hash = 64 hex, same token → same hash', [/^[0-9a-f]{64}$/.test(t.tokenHash), hashApiToken(t.token) === t.tokenHash], [true, true]);
eq('hint = first 8 chars', [t.hint, t.hint.length], [tokenHint(t.token), 8]);
eq('stored copy never contains the token', t.tokenEncrypted.includes(t.token.slice(4)), false);
eq('decrypt(encrypt(token)) = token', decryptToken(t.tokenEncrypted, t.tokenHash), t.token);
eq('encrypting twice gives different text (random IV)', encryptToken(t.token, t.tokenHash) === t.tokenEncrypted, false);
const other = newApiToken();
eq('copy moved to another row (other hash) → null', decryptToken(t.tokenEncrypted, other.tokenHash), null);
const [v, iv, ct, tag] = t.tokenEncrypted.split('.');
const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
eq('changed ciphertext / tag / iv → null', [decryptToken([v, iv, flip(ct), tag].join('.'), t.tokenHash), decryptToken([v, iv, ct, flip(tag)].join('.'), t.tokenHash), decryptToken([v, flip(iv), ct, tag].join('.'), t.tokenHash)], [null, null, null]);
eq('garbage / unknown version / empty → null (no throw)', ['x', 'v2.' + [iv, ct, tag].join('.'), '', '...'].map((s) => decryptToken(s, t.tokenHash)), [null, null, null, null]);
// A copy made with ANOTHER key: decrypt in a child process that has a different TOKEN_ENCRYPTION_KEY.
const childDecrypt = (key: string) =>
  execFileSync('npx', ['tsx', '-e', `import('${new URL('../../backend/src/lib/api-token.ts', import.meta.url).pathname}').then(m => console.log(JSON.stringify(m.decryptToken(${JSON.stringify(t.tokenEncrypted)}, ${JSON.stringify(t.tokenHash)}))))`], { env: { ...process.env, TOKEN_ENCRYPTION_KEY: key }, encoding: 'utf8' }).trim();
eq('same key in another process → token', childDecrypt(env.TOKEN_ENCRYPTION_KEY), JSON.stringify(t.token));
eq('different key → null (shown as "can\'t be shown, renew it")', childDecrypt(Buffer.alloc(32, 7).toString('base64')), 'null');
const now = new Date('2026-10-11T12:00:00Z');
eq('state: active / no expiry', tokenState({ revokedAt: null, expiresAt: null }, now), 'active');
eq('state: expires later → active', tokenState({ revokedAt: null, expiresAt: new Date('2026-10-11T12:00:01Z') }, now), 'active');
eq('state: expires exactly now → expired', tokenState({ revokedAt: null, expiresAt: now }, now), 'expired');
eq('state: revoked wins over expired', tokenState({ revokedAt: now, expiresAt: new Date(0) }, now), 'revoked');

// ── 2. .env checks (the server refuses to start with a bad key) ──
console.log('— .env');
const startEnv = (extra: Record<string, string | undefined>) => {
  try {
    execFileSync('npx', ['tsx', '-e', `import('${new URL('../../backend/src/config/env.ts', import.meta.url).pathname}').then(m => console.log('OK ' + m.env.PUBLIC_BASE_URL))`], { env: { ...process.env, ...extra } as NodeJS.ProcessEnv, encoding: 'utf8', stdio: 'pipe' });
    return 'started';
  } catch (e) {
    const err = e as { status: number; stderr: string };
    return `exit ${err.status}: ${/TOKEN_ENCRYPTION_KEY|PUBLIC_BASE_URL/.exec(err.stderr)?.[0] ?? err.stderr.slice(0, 80)}`;
  }
};
const runEnv = (extra: Record<string, string>) => {
  const out = execFileSync('npx', ['tsx', '-e', `import('${new URL('../../backend/src/config/env.ts', import.meta.url).pathname}').then(m => console.log(m.env.PUBLIC_BASE_URL))`], { env: { ...process.env, ...extra }, encoding: 'utf8' });
  return out.trim();
};
eq('key too short → refuses to start', startEnv({ TOKEN_ENCRYPTION_KEY: 'abc' }), 'exit 1: TOKEN_ENCRYPTION_KEY');
eq('key = 31 bytes → refuses to start', startEnv({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64') }), 'exit 1: TOKEN_ENCRYPTION_KEY');
eq('bad PUBLIC_BASE_URL → refuses to start', startEnv({ PUBLIC_BASE_URL: 'ftp://x' }), 'exit 1: PUBLIC_BASE_URL');
eq('PUBLIC_BASE_URL default = http://localhost:<PORT>', runEnv({ PORT: '4321', PUBLIC_BASE_URL: '' }).replace(/.*\n/, ''), 'http://localhost:4321');
eq('PUBLIC_BASE_URL trailing slash removed', runEnv({ PUBLIC_BASE_URL: 'https://abc.ngrok.app/' }), 'https://abc.ngrok.app');

// ── 3. Database rules (one transaction, rolled back) ──
console.log('— database');
const db = new pg.Client({ connectionString: process.env.DB_URL ?? env.DATABASE_URL });
await db.connect();
await db.query('BEGIN');
const id = (p: string) => `${p}_t41_${Math.random().toString(36).slice(2, 10)}`;
const [userId, orgId, dsId, apiId] = [id('u'), id('o'), id('d'), id('a')];
await db.query(`INSERT INTO users (id, email, password_hash, updated_at) VALUES ($1, $2, 'x', now())`, [userId, `${userId}@test.com`]);
await db.query(`INSERT INTO organizations (id, owner_id, name, slug, updated_at) VALUES ($1, $2, 'T', $1, now())`, [orgId, userId]);
await db.query(`INSERT INTO data_sources (id, organization_id, name, kind, id_column, updated_at) VALUES ($1, $2, 'D', 'upload', 'sku', now())`, [dsId, orgId]);
await db.query(`INSERT INTO apis (id, organization_id, data_source_id, name, slug, updated_at) VALUES ($1, $2, $3, 'A', 'api-t41', now())`, [apiId, orgId, dsId]);
const api = (await db.query(`SELECT auth_header, published_at, status FROM apis WHERE id = $1`, [apiId])).rows[0];
eq('new API: header X-Api-Key, never published, draft', [api.auth_header, api.published_at, api.status], ['x_api_key', null, 'draft']);

// Tries a statement in a savepoint; returns 'ok' or the name of the rule that refused it.
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
const insert = (tok: { tokenHash: string; hint: string; tokenEncrypted: string | null }, extra: { name?: string; revoked?: boolean; api?: string } = {}) =>
  tryIt(`INSERT INTO api_tokens (id, api_id, name, token_hash, token_encrypted, hint, revoked_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())`, [
    id('k'), extra.api ?? apiId, extra.name ?? 'Jivox qa3', tok.tokenHash, tok.tokenEncrypted, tok.hint, extra.revoked ? new Date() : null,
  ]);
eq('valid token row → saved', await insert(t), 'ok');
eq('same token twice → refused (unique hash)', await insert(t), 'api_tokens_token_hash_key');
const fresh = () => newApiToken();
eq('active token without readable copy → refused', await insert({ ...fresh(), tokenEncrypted: null }), 'api_tokens_revoked_no_copy');
eq('revoked token that keeps a copy → refused', await insert(fresh(), { revoked: true }), 'api_tokens_revoked_no_copy');
eq('revoked token without copy → saved', await insert({ ...fresh(), tokenEncrypted: null }, { revoked: true }), 'ok');
eq('blank name / 61 chars → refused', [await insert(fresh(), { name: '   ' }), await insert(fresh(), { name: 'x'.repeat(61) })], ['api_tokens_name_len', 'api_tokens_name_len']);
eq('60-char name → saved', await insert(fresh(), { name: 'x'.repeat(60) }), 'ok');
eq('hint not like rtk_xxxx → refused', await insert({ ...fresh(), hint: 'abcd1234' }), 'api_tokens_hint_format');
eq('hash not 64 hex → refused (e.g. the raw token by mistake)', await insert({ ...fresh(), tokenHash: t.token }), 'api_tokens_hash_format');
eq('token for an API that doesn\'t exist → refused', await insert(fresh(), { api: 'nope' }), 'api_tokens_api_id_fkey');
eq('published without a publish date → refused', await tryIt(`UPDATE apis SET status = 'published' WHERE id = $1`, [apiId]), 'apis_published_has_date');
eq('published with a date → saved', await tryIt(`UPDATE apis SET status = 'published', published_at = now() WHERE id = $1`, [apiId]), 'ok');
eq('unknown header style → refused', await tryIt(`UPDATE apis SET auth_header = 'basic' WHERE id = $1`, [apiId]), '22P02');
eq('header style bearer → saved', await tryIt(`UPDATE apis SET auth_header = 'bearer' WHERE id = $1`, [apiId]), 'ok');
const count = async () => Number((await db.query(`SELECT count(*) FROM api_tokens WHERE api_id = $1`, [apiId])).rows[0].count);
const before = await count();
await db.query(`DELETE FROM apis WHERE id = $1`, [apiId]);
eq(`deleting the API deletes its tokens (${before} → 0)`, [before > 0, await count()], [true, 0]);
// On a nearly empty table Postgres rightly prefers a plain scan; forbid it to prove the index serves the lookup.
await db.query('SET LOCAL enable_seqscan = off');
const plan = (await db.query(`EXPLAIN SELECT id FROM api_tokens WHERE token_hash = $1`, [t.tokenHash])).rows.map((r) => r['QUERY PLAN']).join(' ');
eq('the /v1 lookup by hash uses the unique index', /api_tokens_token_hash_key/.test(plan), true);
await db.query('ROLLBACK');
const left = Number((await db.query(`SELECT count(*) FROM users WHERE id = $1`, [userId])).rows[0].count);
eq('nothing left behind (rolled back)', left, 0);
await db.end();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
