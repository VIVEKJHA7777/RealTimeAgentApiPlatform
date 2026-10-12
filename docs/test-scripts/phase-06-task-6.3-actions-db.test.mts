// Task 6.3: the record of every Submit / Activate (jivox_contract_actions).
//   1. scrubbing + capping what is stored (pure)
//   2. the database rules (one transaction, rolled back)
//   3. the library on real rows: one running action per agent (409 JIVOX_BUSY), finishing, failing,
//      a stale running row taken over, start-up cleanup, size limits, history pages; then races
//      (20 clicks at once on one agent → exactly one; 5 agents at once → all five). Its rows are deleted.
//   cd backend && npx tsx ../docs/test-scripts/phase-06-task-6.3-actions-db.test.mts
import { createRequire } from 'node:module';
import { env } from '../../backend/src/config/env.ts';
import { AppError } from '../../backend/src/lib/app-error.ts';
import { prisma } from '../../backend/src/lib/prisma.ts';
import { failAction, finishAction, getAction, interruptRunningOnBoot, listActions, MAX_ANSWER_BYTES, scrubValue, startAction, STALE_AFTER_MS, storableAnswer } from '../../backend/src/modules/apis/agents/jivox-actions.ts';
const pg = createRequire(new URL('../../backend/package.json', import.meta.url))('pg') as typeof import('pg');

let pass = 0, fail = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`);
};
const TOKEN = 'rtk_' + 'A'.repeat(40);
const KEY = 'bWNwLWF1dGgvZmFrZS1hY2Nlc3Mta2V5LTEyMzQ1Ng';

// ── 1. Scrub + cap (pure) ──
console.log('— scrub + cap');
const dirty = { status: 'failed', evidence: { request: { headers: { Authorization: `Bearer ${TOKEN}`, 'X-Api-Key': TOKEN, Accept: 'json' }, url: `https://x/v1?token=${TOKEN}` }, note: `key was ${KEY}`, list: [TOKEN, 1, null, true] } };
const clean = JSON.stringify(scrubValue(dirty, [KEY]));
eq('no token or access key left anywhere (headers, URL, text, lists)', [clean.includes(TOKEN), clean.includes(KEY)], [false, false]);
eq('credential headers redacted whole; other values / types kept', [(scrubValue(dirty, [KEY]) as typeof dirty).evidence.request.headers, (scrubValue(dirty, [KEY]) as typeof dirty).evidence.list], [{ Authorization: '[Redacted]', 'X-Api-Key': '[Redacted]', Accept: 'json' }, ['rtk_[Redacted]', 1, null, true]]);
eq('short "secrets" (< 8 chars) are ignored (no blanket replacing of "a")', scrubValue('a banana', ['a']), 'a banana');
const big = { data: 'x'.repeat(200_000) + TOKEN };
const stored = storableAnswer(big, []) as { truncated: boolean; bytes: number; preview: string };
eq('an answer over 64 KB → a marked preview under the limit, scrubbed', [stored.truncated, stored.bytes > 200_000, Buffer.byteLength(JSON.stringify(stored)) < MAX_ANSWER_BYTES, JSON.stringify(stored).includes(TOKEN)], [true, true, true, false]);
const multi = storableAnswer({ t: 'ü'.repeat(70_000) }, []) as { preview: string };
eq('the preview is cut on characters (multi-byte text stays valid)', Buffer.byteLength(multi.preview) <= 60_000 && !multi.preview.includes('�'), true);
eq('undefined / null answers are stored as a value', [storableAnswer(undefined, []), storableAnswer(null, [])], [{ value: null }, { value: null }]);

// ── 2. Database rules (rolled back) ──
console.log('— database rules');
const url = process.env.DB_URL ?? env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
await db.connect();
const id = (p: string) => `${p}_t63_${Math.random().toString(36).slice(2, 10)}`;
async function makeAgents(c: InstanceType<typeof pg.Client>, n: number) {
  const [u, o, d, a] = [id('u'), id('o'), id('d'), id('a')];
  await c.query(`INSERT INTO users (id, email, password_hash, updated_at) VALUES ($1, $2, 'x', now())`, [u, `${u}@test.com`]);
  await c.query(`INSERT INTO organizations (id, owner_id, name, slug, updated_at) VALUES ($1, $2, 'T', $1, now())`, [o, u]);
  await c.query(`INSERT INTO data_sources (id, organization_id, name, kind, id_column, updated_at) VALUES ($1, $2, 'D', 'upload', 'sku', now())`, [d, o]);
  await c.query(`INSERT INTO apis (id, organization_id, data_source_id, name, slug, updated_at) VALUES ($1, $2, $3, 'A', $4, now())`, [a, o, d, `t63-${a.slice(-8)}`]);
  const agents: string[] = [];
  for (let i = 0; i < n; i++) {
    const g = id('g');
    await c.query(`INSERT INTO jivox_agents (id, api_id, name, updated_at) VALUES ($1, $2, $3, now())`, [g, a, `Agent ${i}`]);
    agents.push(g);
  }
  return { user: u, api: a, agents };
}
await db.query('BEGIN');
const t = await makeAgents(db, 2);
const [g1, g2] = t.agents;
const tryIt = async (sql: string, params: unknown[]) => {
  await db.query('SAVEPOINT s');
  try { await db.query(sql, params); await db.query('RELEASE SAVEPOINT s'); return 'ok'; }
  catch (e) { await db.query('ROLLBACK TO SAVEPOINT s'); return (e as { constraint?: string; code?: string }).constraint ?? (e as { code?: string }).code; }
};
type Row = { agent?: string; kind?: string; state?: string; outcome?: string | null; version?: number | null; doc?: unknown; answer?: unknown; err?: string | null; finished?: string | null; host?: string; checks?: unknown; status?: string | null };
const row = (r: Row = {}) => tryIt(
  `INSERT INTO jivox_contract_actions (id, agent_id, kind, state, outcome, version, document, answer, error_message, finished_at, mcp_host, failed_checks, jivox_status, started_by_id)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
  [id('x'), r.agent ?? g1, r.kind ?? 'submit', r.state ?? 'done', r.outcome === undefined ? 'verified' : r.outcome, r.version === undefined ? 1 : r.version,
    r.doc === undefined ? JSON.stringify({ contract_format: 'contract/1' }) : r.doc, r.answer === undefined ? JSON.stringify({ status: 'verified' }) : r.answer, r.err ?? null,
    r.finished === undefined ? new Date().toISOString() : r.finished, r.host ?? 'brandstore-data-mcp.qa3.jivox.com', r.checks === undefined ? [] : r.checks, r.status ?? null, t.user],
);
eq('a finished submit (verified v1) / activate (activated v1) → saved', [await row(), await row({ kind: 'activate', outcome: 'activated', doc: null })], ['ok', 'ok']);
eq('a running submit: no outcome, no finish time → saved', await row({ state: 'running', outcome: null, finished: null, answer: null }), 'ok');
eq('a SECOND running row for the same agent → refused (the one-at-a-time rule)', await row({ state: 'running', outcome: null, finished: null, answer: null, kind: 'activate', doc: null }), 'jivox_contract_actions_one_running');
eq('…but another agent may run at the same time', await row({ agent: g2, state: 'running', outcome: null, finished: null, answer: null }), 'ok');
// An unknown state breaks two rules at once (state, lifecycle): Postgres names either one.
eq('unknown kind / state / outcome → refused', [await row({ kind: 'delete' }), /^jivox_contract_actions_(state|lifecycle)$/.test(String(await row({ state: 'paused' }))), await row({ outcome: 'maybe' })], ['jivox_contract_actions_kind', true, 'jivox_contract_actions_outcome']);
eq('running with an outcome / a finish time → refused', [await row({ agent: g2, state: 'running', answer: null, finished: null }), await row({ agent: g2, state: 'running', outcome: null, answer: null })], ['jivox_contract_actions_lifecycle', 'jivox_contract_actions_lifecycle']);
eq('done without its answer / finish time / outcome → refused', [await row({ answer: null }), await row({ finished: null }), await row({ outcome: null })], ['jivox_contract_actions_lifecycle', 'jivox_contract_actions_lifecycle', 'jivox_contract_actions_lifecycle']);
eq('error without its message → refused; with it → saved', [await row({ state: 'error', outcome: 'timeout', answer: null }), await row({ state: 'error', outcome: 'timeout', answer: null, err: 'No answer in 60 s' })], ['jivox_contract_actions_lifecycle', 'ok']);
eq('a submit "activated" / an activate "verified" → refused', [await row({ outcome: 'activated' }), await row({ kind: 'activate', outcome: 'verified' })], ['jivox_contract_actions_outcome_kind', 'jivox_contract_actions_outcome_kind']);
eq('a submit without its document / with a list as document → refused', [await row({ doc: null }), await row({ doc: '[1]' })], ['jivox_contract_actions_submit_document', 'jivox_contract_actions_submit_document']);
eq('an activate without its version / "verified" without a version / version 0 → refused', [await row({ kind: 'activate', outcome: 'activated', doc: null, version: null }), await row({ version: null }), await row({ version: 0 })], ['jivox_contract_actions_activate_version', 'jivox_contract_actions_verified_version', 'jivox_contract_actions_version_positive']);
eq('a failed submit has no version → saved', await row({ outcome: 'failed', version: null }), 'ok');
eq('finished before it started → refused', await row({ finished: '2000-01-01T00:00:00Z' }), 'jivox_contract_actions_times');
eq('answer over 64 KB / document over 256 KB / message over 1000 / host blank → refused', [await row({ answer: JSON.stringify({ x: 'a'.repeat(70_000) }) }), await row({ doc: JSON.stringify({ x: 'a'.repeat(270_000) }) }), await row({ state: 'error', outcome: 'timeout', answer: null, err: 'e'.repeat(1001) }), await row({ host: '' })], ['jivox_contract_actions_sizes', 'jivox_contract_actions_sizes', 'jivox_contract_actions_sizes', 'jivox_contract_actions_sizes']);
eq('failed checks: NULL list / NULL entry → refused; ["base_url","types"] → saved', [await row({ checks: null }), await row({ checks: ['base_url', null] }), await row({ checks: ['base_url', 'types'] })], ['jivox_contract_actions_failed_checks', 'jivox_contract_actions_failed_checks', 'ok']);
eq('Jivox status over 50 chars → refused', await row({ status: 's'.repeat(51) }), 'jivox_contract_actions_sizes');
const count = async (where: string, p: unknown[]) => Number((await db.query(`SELECT count(*) FROM jivox_contract_actions WHERE ${where}`, p)).rows[0].count);
const helper = id('u');
await db.query(`INSERT INTO users (id, email, password_hash, updated_at) VALUES ($1, $2, 'x', now())`, [helper, `${helper}@test.com`]);
await db.query(`UPDATE jivox_contract_actions SET started_by_id = $1 WHERE agent_id = $2`, [helper, g2]);
eq('deleting the user who started actions keeps the history; "started by" becomes empty', [await tryIt(`DELETE FROM users WHERE id = $1`, [helper]), await count('agent_id = $1 AND started_by_id IS NULL', [g2]) > 0, await count('agent_id = $1 AND started_by_id IS NOT NULL', [g2])], ['ok', true, 0]);
const n1 = await count('agent_id = $1', [g1]);
eq(`deleting an agent deletes its history (${n1} rows), the other agent's stays`, [await tryIt(`DELETE FROM jivox_agents WHERE id = $1`, [g1]), await count('agent_id = $1', [g1]), await count('agent_id = $1', [g2]) > 0], ['ok', 0, true]);
await db.query('SET LOCAL enable_seqscan = off');
const plan = (await db.query(`EXPLAIN SELECT id FROM jivox_contract_actions WHERE agent_id = $1 ORDER BY started_at DESC LIMIT 20`, [g2])).rows.map((r) => r['QUERY PLAN']).join(' ');
eq('the history uses the (agent_id, started_at DESC) index', /jivox_contract_actions_agent_id_started_at_idx/.test(plan), true);
await db.query('ROLLBACK');

// ── 3. The library on real rows ──
console.log('— library');
const r = await makeAgents(db, 7); // committed; deleted at the end
const [a1, a2, ...others] = r.agents;
const busyOf = async (p: Promise<unknown>) => p.then(() => 'started', (e) => (e instanceof AppError ? `${e.status} ${e.code}` : String(e)));
const s1 = await startAction({ agentId: a1, kind: 'submit', mcpHost: 'brandstore-data-mcp.qa3.jivox.com', document: { contract_format: 'contract/1' }, designVersion: 7, failedChecks: ['base_url'], startedById: r.user });
eq('start a submit → running, with host / design version / failed checks / who', [s1.state, s1.mcpHost, s1.designVersion, s1.failedChecks, s1.startedById === r.user], ['running', 'brandstore-data-mcp.qa3.jivox.com', 7, ['base_url'], true]);
const second = await startAction({ agentId: a1, kind: 'activate', mcpHost: 'h', version: 2 }).then(() => null, (e: AppError) => e);
eq('a second action on the same agent → 409 JIVOX_BUSY, saying what runs', [second?.status, second?.code, /A submit for this agent is still running \(started \d+ s ago\)/.test(second?.message ?? ''), (second?.extra?.running as { kind: string }).kind], [409, 'JIVOX_BUSY', true, 'submit']);
eq('another agent → may start at the same time', await busyOf(startAction({ agentId: a2, kind: 'activate', mcpHost: 'h', version: 3 })), 'started');
const done = await finishAction(s1.id, { outcome: 'verified', jivoxStatus: 'verified', version: 4, answer: { status: 'verified', version: 4, echo: { Authorization: `Bearer ${TOKEN}`, text: `key ${KEY}` } } }, [KEY]);
eq('finish → done, verified v4, Jivox status kept, answer scrubbed', [done?.state, done?.outcome, done?.version, done?.jivoxStatus, JSON.stringify(done?.answer).includes(TOKEN) || JSON.stringify(done?.answer).includes(KEY)], ['done', 'verified', 4, 'verified', false]);
eq('finishing it again → null (only a running row is finished)', await finishAction(s1.id, { outcome: 'failed', answer: {} }), null);
eq('after it finished, the next action may start', await busyOf(startAction({ agentId: a1, kind: 'activate', mcpHost: 'h', version: 4 }).then((x) => failAction(x.id, { outcome: 'timeout', message: `No answer in 60 s (key ${KEY})` }, [KEY]))), 'started');
const last = (await listActions(a1)).actions[0];
eq('fail → error, timeout, the message scrubbed', [last.state, last.outcome, last.errorMessage], ['error', 'timeout', 'No answer in 60 s (key [Redacted])']);
// A running row left behind by a restart: older than STALE_AFTER_MS → taken over; younger → busy.
await db.query(`INSERT INTO jivox_contract_actions (id, agent_id, kind, state, mcp_host, version, started_at) VALUES ($1, $2, 'activate', 'running', 'h', 1, now() - make_interval(secs => $3))`, [id('x'), others[0], STALE_AFTER_MS / 1000 + 30]);
const taken = await startAction({ agentId: others[0], kind: 'submit', mcpHost: 'h', document: { a: 1 } });
const old = (await db.query(`SELECT state, outcome, error_message FROM jivox_contract_actions WHERE agent_id = $1 AND id <> $2`, [others[0], taken.id])).rows[0];
eq(`a running row ${STALE_AFTER_MS / 60000}+ min old → marked interrupted (with why), the new one runs`, [old.state, old.outcome, /server restarted/.test(old.error_message), taken.state], ['error', 'interrupted', true, 'running']);
await db.query(`INSERT INTO jivox_contract_actions (id, agent_id, kind, state, mcp_host, version, started_at) VALUES ($1, $2, 'activate', 'running', 'h', 1, now() - interval '60 seconds')`, [id('x'), others[1]]);
eq('a running row 1 min old → still busy (Jivox may still answer)', await busyOf(startAction({ agentId: others[1], kind: 'submit', mcpHost: 'h', document: { a: 1 } })), '409 JIVOX_BUSY');
const runningBefore = Number((await db.query(`SELECT count(*) FROM jivox_contract_actions WHERE state = 'running'`)).rows[0].count);
const marked = await interruptRunningOnBoot();
eq(`start-up: every running row (${runningBefore}) → interrupted; finishing one afterwards changes nothing`, [marked, runningBefore, await finishAction(taken.id, { outcome: 'verified', version: 1, answer: {} }), (await getAction(others[0], taken.id))?.outcome], [runningBefore, runningBefore, null, 'interrupted']);
eq('a contract over 256 KB → 413 CONTRACT_TOO_BIG (nothing stored)', await busyOf(startAction({ agentId: others[2], kind: 'submit', mcpHost: 'h', document: { x: 'a'.repeat(270_000) } })), '413 CONTRACT_TOO_BIG');
const bigDone = await startAction({ agentId: others[2], kind: 'submit', mcpHost: 'h', document: { a: 1 } }).then((x) => finishAction(x.id, { outcome: 'failed', answer: { evidence: 'e'.repeat(300_000) } }));
eq('a 300 KB answer from Jivox → stored as a truncated preview', [(bigDone?.answer as { truncated?: boolean }).truncated, Buffer.byteLength(JSON.stringify(bigDone?.answer)) < MAX_ANSWER_BYTES], [true, true]);
eq('an unknown status from Jivox → "unknown", its word kept', await startAction({ agentId: others[3], kind: 'submit', mcpHost: 'h', document: { a: 1 } }).then((x) => finishAction(x.id, { outcome: 'unknown', jivoxStatus: 'queued_for_review', answer: { status: 'queued_for_review' } })).then((x) => [x?.outcome, x?.jivoxStatus]), ['unknown', 'queued_for_review']);
// History pages: 25 actions on one agent → 20 + 5, newest first, light rows.
for (let i = 0; i < 25; i++) {
  const x = await startAction({ agentId: others[4], kind: 'activate', mcpHost: 'h', version: i + 1 });
  await finishAction(x.id, { outcome: 'activated', version: i + 1, answer: { i } });
}
const p1 = await listActions(others[4]);
const p2 = await listActions(others[4], { before: p1.next! });
eq('history: 20 newest first, then the last 5, then no more; light rows (no document / answer)', [p1.actions.length, p1.actions[0].version, p1.actions[19].version, p2.actions.length, p2.actions[4].version, p2.next, 'answer' in p1.actions[0] || 'document' in p1.actions[0]], [20, 25, 6, 5, 1, null, false]);
eq('one row in full (answer kept); another agent\'s id → null', [((await getAction(others[4], p1.actions[0].id))?.answer as { i: number }).i, await getAction(a1, p1.actions[0].id)], [24, null]);

// ── 4. Races ──
console.log('— races');
const results = await Promise.all(Array.from({ length: 20 }, () => busyOf(startAction({ agentId: a1, kind: 'submit', mcpHost: 'h', document: { a: 1 } }))));
if (!results.includes('started')) console.log('   race results:', [...new Set(results)]);
eq('20 clicks at the same moment on ONE agent → exactly 1 started, 19 JIVOX_BUSY', [results.filter((x) => x === 'started').length, results.filter((x) => x === '409 JIVOX_BUSY').length], [1, 19]);
await interruptRunningOnBoot();
const fresh = await makeAgents(db, 5);
const across = await Promise.all(fresh.agents.map((g) => busyOf(startAction({ agentId: g, kind: 'submit', mcpHost: 'h', document: { a: 1 } }))));
eq('5 different agents at the same moment → all 5 start', across, ['started', 'started', 'started', 'started', 'started']);
await interruptRunningOnBoot();

// Clean up the committed rows (users → brands → APIs → agents → actions, by cascade).
for (const u of [r.user, fresh.user]) {
  await db.query(`DELETE FROM organizations WHERE owner_id = $1`, [u]);
  await db.query(`DELETE FROM users WHERE id = $1`, [u]);
}
eq('nothing left behind', Number((await db.query(`SELECT count(*) FROM jivox_contract_actions a JOIN jivox_agents g ON g.id = a.agent_id WHERE g.id = ANY($1)`, [[...r.agents, ...fresh.agents]])).rows[0].count), 0);
await db.end();
await prisma.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
