// Task 7.6: the test switches' pure helpers (frontend/src/lib/switches.ts): "ends in …", who gets it, the banner's
// lines, the next end, the agent panel's split, the form's options, slow-time checks, scope choices, the groups.
//   cd frontend && npx tsx ../docs/test-scripts/phase-07-task-7.6-switches-lib.test.ts
import type { ActiveSwitch } from '../../frontend/src/lib/api-types.ts'
import {
  bannerItem, bannerTitle, clockOffset, endsIn, forToken, nextEnd, optionsFor, running, scopeChoices, scopeLabel, slowProblem, SWITCH_GROUPS,
} from '../../frontend/src/lib/switches.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }

const now = new Date('2026-10-12T10:00:00Z').getTime()
const at = (min: number) => new Date(now + min * 60_000).toISOString()
eq('ends in: < 1 min · 1 · 42 · 60 · 185 min · past', [endsIn(at(0.5), now), endsIn(at(1), now), endsIn(at(42), now), endsIn(at(60), now), endsIn(at(185), now), endsIn(at(-1), now)], ['in less than a minute', 'in 1 min', 'in 42 min', 'in 1 h', 'in 3 h 5 min', 'now'])
eq('ends in: 41.2 min rounds UP (never says less than is left)', endsIn(at(41.2), now), 'in 42 min')
eq('clock offset: the server is 90 s ahead', clockOffset('2026-10-12T10:01:30Z', now), 90_000)

const sw = (o: Partial<ActiveSwitch>): ActiveSwitch => ({ kind: 'drop_id', options: {}, scope: null, applyToOwnChecks: false, since: at(-5), endsAt: at(42), setBy: 'v@jivox.com', ...o })
const agent2 = { tokenId: 't2', tokenName: 'Jivox qa3 B', tokenHint: 'rtk_ab', revoked: false, agents: [{ id: 'a2', name: 'Agent 2' }] }
eq('who: every caller · one agent · two agents · a token without agent · revoked', [
  scopeLabel(sw({})),
  scopeLabel(sw({ scope: agent2 })),
  scopeLabel(sw({ scope: { ...agent2, agents: [{ id: 'a1', name: 'Agent 1' }, { id: 'a2', name: 'Agent 2' }] } })),
  scopeLabel(sw({ scope: { ...agent2, agents: [] } })),
  scopeLabel(sw({ scope: { ...agent2, revoked: true } })),
], ['every caller', 'Agent 2 only', 'Agent 1, Agent 2 only', 'token "Jivox qa3 B" only', 'Agent 2 only (token revoked: no calls match)'])
eq('banner lines (with options, own checks)', [
  bannerItem(sw({ scope: agent2 }), now),
  bannerItem(sw({ kind: 'slow', options: { ms: 5000 }, applyToOwnChecks: true, endsAt: at(12) }), now),
  bannerItem(sw({ kind: 'http_status', options: { status: 503 }, endsAt: at(240) }), now),
], ['Drop an id (Agent 2 only, ends in 42 min)', 'Slow answer (5 000 ms) (every caller, our own checks too, ends in 12 min)', 'HTTP status (503) (every caller, ends in 4 h)'])
eq('banner title: 1 · 3', [bannerTitle(1), bannerTitle(3)], ['1 test switch on: this API answers wrongly on purpose.', '3 test switches on: this API answers wrongly on purpose.'])
eq('next end = the earliest · none', [nextEnd([sw({ endsAt: at(42) }), sw({ endsAt: at(12) })]) === now + 12 * 60_000, nextEnd([])], [true, null])
eq('running hides an ended one at once', running([sw({ endsAt: at(-0.1) }), sw({ kind: 'slow', endsAt: at(1) })], now).map((s) => s.kind), ['slow'])
const all = [sw({ kind: 'drop_id', scope: agent2 }), sw({ kind: 'no_store' }), sw({ kind: 'extra_id', scope: { ...agent2, tokenId: 't1', agents: [{ id: 'a1', name: 'Agent 1' }] } })]
eq('agent panel: Agent 2 gets its own + every-caller ones; an agent without token only every-caller', [forToken(all, 't2').mine.map((s) => s.kind), forToken(all, 't2').everyone.map((s) => s.kind), forToken(all, null).mine.length], [['drop_id'], ['no_store'], 0])
eq('form options per kind (only what the kind takes)', [optionsFor('wrong_type', { field: 'price', ms: 1, status: 500 }), optionsFor('slow', { field: '', ms: 4000, status: 500 }), optionsFor('http_status', { field: '', ms: 1, status: 429 }), optionsFor('drop_id', { field: 'x', ms: 9, status: 500 })], [{ field: 'price' }, { ms: 4000 }, { status: 429 }, {}])
eq('slow time typed by hand', ['3500', ' 10 ', '0', '30001', 'abc', '1.5', '30000'].map(slowProblem), [null, null, 'At least 1 ms', 'At most 30 000 ms', 'A whole number of milliseconds', 'A whole number of milliseconds', null])
eq('scope choices: every caller, active tokens by agents, a token without agent, revoked left out', scopeChoices(
  [{ id: 't1', name: 'Jivox qa3', revokedAt: null }, { id: 'old', name: 'Old', revokedAt: '2026-10-12T00:00:00Z' }, { id: 't3', name: 'Spare', revokedAt: null }],
  [{ name: 'Agent 1', token: { id: 't1' } }, { name: 'Draft', token: null }],
), [{ value: 'all', label: 'Every caller' }, { value: 't1', label: 'Agent 1 (Jivox qa3)' }, { value: 't3', label: 'Token "Spare" (no agent)' }])
const kinds = SWITCH_GROUPS.flatMap((g) => g.kinds)
eq('the groups hold each of the 12 switches exactly once', [kinds.length, new Set(kinds).size], [12, 12])

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
