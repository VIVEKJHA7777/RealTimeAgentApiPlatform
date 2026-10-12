// Task 6.4: reading Jivox's answers loosely (jivox-answers.ts) + the write-host rule. No network.
// Jivox's real write answers are unknown until 6.6, so besides the fake's shapes this feeds other
// plausible ones (state / result / errors as text / version inside contract) and nonsense.
//   cd backend && npx tsx ../docs/test-scripts/phase-06-task-6.4-answers-lib.test.ts
import { readFileSync } from 'node:fs';
import { hintsFor, readActivate, readSubmit, readVersions } from '../../backend/src/modules/apis/agents/jivox-answers.ts';
import { writeAllowed } from '../../backend/src/modules/apis/agents/jivox-writes.service.ts';

let pass = 0, fail = 0;
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`); };
const pick = (r: ReturnType<typeof readSubmit>) => [r.outcome, r.version, r.jivoxStatus];

// ── submit ──
eq('fake: verified + version', pick(readSubmit({ status: 'verified', version: 3, message: 'Verified as version 3.' })), ['verified', 3, 'verified']);
eq('other spellings: state "VERIFIED", result "ok", version as text / inside contract', [pick(readSubmit({ state: 'VERIFIED', version: '4' })), pick(readSubmit({ result: 'ok', contract: { version: 5 } }))], [['verified', 4, 'VERIFIED'], ['verified', 5, 'ok']]);
eq('"verified" WITHOUT a version → unknown (nothing to activate)', pick(readSubmit({ status: 'verified' })), ['unknown', null, 'verified']);
eq('invalid / gate_failed / failed (and "gate-failed", "verification failed", "rejected")', ['invalid', 'gate_failed', 'gate-failed', 'failed', 'verification failed', 'rejected'].map((s) => readSubmit({ status: s, version: 9 }).outcome), ['invalid', 'gate_failed', 'gate_failed', 'failed', 'failed', 'failed']);
eq('a failed one never carries a version', readSubmit({ status: 'failed', version: 9 }).version, null);
eq('a status we don\'t know → unknown, its word kept', pick(readSubmit({ status: 'queued_for_review' })), ['unknown', null, 'queued_for_review']);
eq('nonsense (text, list, null) → unknown, no crash', [readSubmit('oops').outcome, readSubmit([1]).outcome, readSubmit(null).outcome], ['unknown', 'unknown', 'unknown']);
const inv = readSubmit({ status: 'invalid', errors: [{ code: 'ID_PLACEHOLDER', path: '$.request', message: '{item_id} appears 2 times.', fix: 'Put it exactly once.' }, 'plain text error', { detail: 'only a detail', hint: 'a hint' }] });
eq('errors as objects / plain text / other key names → problems', inv.problems, [
  { code: 'ID_PLACEHOLDER', message: '{item_id} appears 2 times.', fix: 'Put it exactly once.', path: '$.request' },
  { code: null, message: 'plain text error', fix: null, path: null },
  { code: null, message: 'only a detail', fix: 'a hint', path: null },
]);
const failed = readSubmit({ status: 'failed', step: 'verification', evidence: { request: { url: 'https://x/v1/b/p?ids=1' }, response: { status: 401 }, problems: ['HTTP 401: expected 2xx.', 'status is "failure": expected "success".'] } });
eq('failed: the evidence kept whole, its problems listed', [failed.problems.length, (failed.evidence as { response: { status: number } }).response.status], [2, 401]);
eq('  hint: a 401 → paste the token in Studio', failed.hints.map((h) => h.place), ['studio']);

// ── Jivox's FIRST REAL answer (qa3, 2026-10-12): the exact shape it sent ──
const real = readSubmit({ status: 'invalid', errors: [{ code: 'BAD_DOCUMENT', message: String.raw`'$.data[*].sub-category' does not match '^\$\.data\[\*\]\.[A-Za-z0-9_]+$'` }] });
eq('real qa3 answer: invalid, one BAD_DOCUMENT problem (no fix from Jivox), our hint → Design tab', [real.outcome, real.problems.map((p) => [p.code, p.fix]), real.hints.map((h) => h.place)], ['invalid', [['BAD_DOCUMENT', null]], ['design']]);

// ── Jivox's real VERIFIED / ACTIVE answers (qa3, 2026-10-12) ──
const real2 = (f: string) => JSON.parse(readFileSync(new URL(`../jivox/qa3-answers-2026-10-12/${f}`, import.meta.url), 'utf8'));
const rv = readSubmit(real2('submit-verified.json'));
eq('real verified: v1, Jivox\'s `note` is the message, `verification` is the evidence, no problems', [rv.outcome, rv.version, rv.message, (rv.evidence as { cache_control_ok: boolean }).cache_control_ok, rv.problems.length], ['verified', 1, 'Call activate_contract(version=1) to make it live.', true, 0]);
const ra = readActivate(real2('activate-active.json'), 1);
eq('real active: activated v1, previous_active null → nothing retired', [ra.outcome, ra.version, ra.retired, ra.problems.length], ['activated', 1, null, 0]);
eq('previous_active as a number / an object → retired', [readActivate({ status: 'active', version: 2, previous_active: 1 }, 2).retired, readActivate({ status: 'active', version: 2, previous_active: { version: 1 } }, 2).retired], [1, 1]);
const vf = readSubmit({ status: 'failed', verification: { passed: false, failure: 'verification failed', http_status: 200, status_ok: true, cache_control_ok: false, id_check: { missing: ['2'], duplicates: [], unexpected: ['9'], without_id: 1 }, api_errors: [{ error_id: '2' }], fields: [{ column_name: 'current_price', pass: false, failure_reason: '"" is not a float' }, { column_name: 'sub_title', pass: true }] } });
eq('a failed `verification` → one problem per thing that didn\'t pass', vf.problems.map((p) => p.code), ['VERIFICATION', 'CACHE_CONTROL', 'IDS_MISSING', 'IDS_UNEXPECTED', 'ITEMS_WITHOUT_ID', 'API_ERRORS', 'FIELD']);
eq('  …with our hints (no-store → settings, missing ids → agent, a field type → design)', vf.hints.map((h) => h.place).sort(), ['agent', 'design', 'settings']);
eq('  a non-2xx status in `verification` stands alone (the rest follow from it)', readSubmit({ status: 'failed', verification: { passed: false, http_status: 401, status_ok: false, id_check: { missing: ['1', '2'] } } }).hints.map((h) => h.place), ['studio']);
eq('a passed `verification` adds no problem even with odd flags', readSubmit({ status: 'verified', version: 1, verification: { passed: true, cache_control_ok: false } }).problems, []);

// ── hints ──
const h = (code: string | null, message: string) => hintsFor([{ code, message, fix: null, path: null }]).map((x) => x.place);
eq('by code: NOT_BOUND → agent · MANDATORY_FIELD → agent · ID_PLACEHOLDER → design · TOKEN_FORMAT → tokens', [h('NOT_BOUND', 'x'), h('MANDATORY_FIELD', 'x'), h('ID_PLACEHOLDER', 'x'), h('TOKEN_FORMAT', 'x')], [['agent'], ['agent'], ['design'], ['tokens']]);
eq('by words: 404 → publish · "expected float" → design · "appears 0 times" → agent · timeout → settings', [h(null, 'HTTP 404: expected 2xx.'), h(null, 'current_price is "": expected float.'), h(null, 'id SKU-9 appears 0 times'), h(null, 'No answer within 3000 ms.')], [['publish'], ['design'], ['agent'], ['settings']]);
eq('nothing recognised → no hint (Jivox\'s words stand alone)', h(null, 'the moon is full'), []);
eq('a non-2xx HTTP problem stands alone (the missing ids only follow from it)', hintsFor([{ code: null, message: 'HTTP 401: expected 2xx.', fix: null, path: null }, { code: null, message: 'id SKU-1 appears 0 times', fix: null, path: null }]).map((x) => x.place), ['studio']);
eq('each place at most once', hintsFor([{ code: null, message: 'HTTP 401', fix: null, path: null }, { code: null, message: 'missing token', fix: null, path: null }]).length, 1);

// ── activate ──
const act = (a: unknown, v = 3) => { const r = readActivate(a, v); return [r.outcome, r.version, r.retired]; };
eq('fake: active + retired', act({ status: 'active', version: 3, retired: 2 }), ['activated', 3, 2]);
eq('"activated" / "ok", previous_version, retired as an object', [act({ status: 'activated', previous_version: 1 }), act({ result: 'ok', retired: { version: 2 } })], [['activated', 3, 1], ['activated', 3, 2]]);
eq('refused with a reason → the reason is a problem', (() => { const r = readActivate({ status: 'refused', reason: 'not_verified', message: 'Version 2 is retired.' }, 2); return [r.outcome, r.problems[0].code, r.problems[0].message]; })(), ['refused', 'not_verified', 'Version 2 is retired.']);
eq('unknown word / nonsense → unknown, the version asked for kept', [act({ status: 'pending' }, 7), act('x', 7)], [['unknown', 7, null], ['unknown', 7, null]]);

// ── versions ──
const v = readVersions({ contracts: [{ version: 2, status: 'active', created_at: '2026-10-12T10:00:00Z', fields: ['item_id'] }, { version: 1, status: 'verified' }, { status: 'verified' }], active_version: 2 });
eq('versions sorted oldest first, the active one marked, extra fields kept, broken entries dropped', [v.versions.map((x) => [x.version, x.status, x.active]), v.activeVersion, v.versions[1].extra.fields], [[[1, 'verified', false], [2, 'active', true]], 2, ['item_id']]);
eq('"versions" key / no active_version but a status active → found', readVersions({ versions: [{ version: 4, status: 'active' }] }).activeVersion, 4);
eq('empty (qa3 5.0 snapshot) / nonsense → no versions', [readVersions({ contracts: [], active_version: null }), readVersions('x')], [{ versions: [], activeVersion: null }, { versions: [], activeVersion: null }]);

// ── write hosts (P6-2) ──
eq('not set → any host (user\'s choice)', writeAllowed('brandstore-data-mcp.qa2.example.com', undefined), true);
eq('qa3 only → qa3 yes (any port), qa2 no; "*" → any', [writeAllowed('brandstore-data-mcp.qa3.jivox.com', 'brandstore-data-mcp.qa3.jivox.com'), writeAllowed('brandstore-data-mcp.qa3.jivox.com:443', 'brandstore-data-mcp.qa3.jivox.com'), writeAllowed('brandstore-data-mcp.qa2.jivox.com', 'brandstore-data-mcp.qa3.jivox.com'), writeAllowed('x.y', '*')], [true, true, false, true]);
eq('a look-alike host is not the allowed one', writeAllowed('brandstore-data-mcp.qa3.jivox.com.evil.io', 'brandstore-data-mcp.qa3.jivox.com'), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
