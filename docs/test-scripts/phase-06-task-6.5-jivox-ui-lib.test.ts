// Task 6.5: the Jivox chip and the words for each submit / activate (frontend/src/lib/agents.ts).
//   cd frontend && npx tsx ../docs/test-scripts/phase-06-task-6.5-jivox-ui-lib.test.ts
import { actionTitle, jivoxChip, OUTCOME } from '../../frontend/src/lib/agents.ts'
import type { Agent, JivoxAction, JivoxActionSummary } from '../../frontend/src/lib/api-types.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }

const at = '2026-10-12T10:00:00Z'
const agent = (j: Partial<JivoxActionSummary> | null, connected = true) => ({ mcpUrl: connected ? 'https://x/mcp' : null, accessKey: connected ? { hint: 'Rm', readable: true } : null, jivoxActions: j && { activeVersion: null, activatedAt: null, lastSubmit: null, running: null, ...j } }) as unknown as Agent
const chip = (a: Agent) => [jivoxChip(a).text, jivoxChip(a).tone]
eq('not connected / never submitted', [chip(agent(null, false)), chip(agent(null))], [['Not connected', 'muted'], ['Not submitted', 'muted']])
eq('running: submit → Sending… / activate → Activating v3…', [chip(agent({ running: { kind: 'submit', version: null, startedAt: at } })), chip(agent({ running: { kind: 'activate', version: 3, startedAt: at } }))], [['Sending…', 'busy'], ['Activating v3…', 'busy']])
eq('verified, nothing active → "v1 verified" (activate it)', chip(agent({ lastSubmit: { outcome: 'verified', version: 1, at } })), ['v1 verified', 'warn'])
eq('v2 active, nothing newer → "v2 active"', chip(agent({ activeVersion: 2, lastSubmit: { outcome: 'verified', version: 2, at } })), ['v2 active', 'ok'])
eq('v2 active, v3 verified → "v3 verified" (newer, not live yet)', chip(agent({ activeVersion: 2, lastSubmit: { outcome: 'verified', version: 3, at } })), ['v3 verified', 'warn'])
eq('v2 active, last submit failed → still "v2 active" (the live one), the title says the last failed', [chip(agent({ activeVersion: 2, lastSubmit: { outcome: 'failed', version: null, at } })), /last submit didn't verify/.test(jivoxChip(agent({ activeVersion: 2, lastSubmit: { outcome: 'failed', version: null, at } })).title ?? '')], [['v2 active', 'ok'], true])
eq('never verified, last submit failed / unreachable → "Not verified" (title names why)', [chip(agent({ lastSubmit: { outcome: 'failed', version: null, at } })), jivoxChip(agent({ lastSubmit: { outcome: 'unreachable', version: null, at } })).title], [['Not verified', 'fail'], "Last submit: couldn't reach Jivox"])
const act = (a: Partial<JivoxAction>) => ({ id: 'x', kind: 'submit', state: 'done', outcome: 'verified', version: 3, failedChecks: [], ...a }) as JivoxAction
eq('titles: submit verified / failed / running; activate with retired; Jivox stays capitalised', [actionTitle(act({})), actionTitle(act({ outcome: 'failed', version: null })), actionTitle(act({ state: 'running', outcome: null })), actionTitle(act({ kind: 'activate', outcome: 'activated', version: 3, retired: 2 })), actionTitle(act({ outcome: 'bad_answer', version: null }))], ['Submit → verified v3', 'Submit → failed verification', 'Submit → waiting for Jivox', 'Activate v3 → activated (v2 retired)', 'Submit → Jivox answered with an error'])
eq('every outcome has words and a tone', Object.values(OUTCOME).every((o) => o.text && o.tone), true)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
