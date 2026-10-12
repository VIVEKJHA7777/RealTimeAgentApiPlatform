// Fix (2026-10-13): the Overview's "Contract and Jivox" step was always "to do". Now it comes from the agents'
// Jivox submits / activations (frontend/src/lib/agents.ts jivoxStep).
//   cd frontend && npx tsx ../docs/test-scripts/phase-07-fix-overview-jivox-step-lib.test.ts
import type { Agent, JivoxActionSummary } from '../../frontend/src/lib/api-types.ts'
import { jivoxStep } from '../../frontend/src/lib/agents.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }
const agent = (name: string, j: Partial<JivoxActionSummary> | null) => ({ name, jivoxActions: j && { activeVersion: null, activatedAt: null, lastSubmit: null, running: null, ...j } }) as unknown as Agent
const at = '2026-10-13T00:00:00Z'

eq('loading → the neutral "to do"', jivoxStep(null), { state: 'todo', text: 'Generate the contract/1 document and activate it on Jivox.' })
eq('no agent → add one', jivoxStep([]).text, 'Add the Jivox agent on the Jivox tab, then submit and activate its contract.')
eq('agents, nothing submitted', [jivoxStep([agent('Agent 1', null)]).text, jivoxStep([agent('Agent 1', null), agent('Agent 2', {})]).text], ['Agent 1 added: submit the contract and activate it on the Jivox tab.', '2 agents added: submit the contract and activate it on the Jivox tab.'])
eq('THE CASE: Agent 1 active v1 → done (the screenshot)', jivoxStep([agent('Agent 1', { activeVersion: 1, activatedAt: at })]), { state: 'done', text: 'Active on Jivox: Agent 1 (v1).' })
eq('one active, one not → done, naming the other', jivoxStep([agent('Agent 1', { activeVersion: 1 }), agent('Agent 2', null)]).text, 'Active on Jivox: Agent 1 (v1) · not yet: Agent 2.')
eq('both active', jivoxStep([agent('Agent 1', { activeVersion: 1 }), agent('Agent 2', { activeVersion: 3 })]).text, 'Active on Jivox: Agent 1 (v1), Agent 2 (v3).')
eq('a submit / activation running wins (shows progress)', [jivoxStep([agent('Agent 1', { activeVersion: 1, running: { kind: 'activate', version: 2, startedAt: at } })]), jivoxStep([agent('Agent 2', { running: { kind: 'submit', version: null, startedAt: at } })]).text],
  [{ state: 'running', text: 'Agent 1: activating v2 on Jivox…' }, 'Agent 2: submitting the contract to Jivox…'])
eq('verified, not activated → to do with the next action', jivoxStep([agent('Agent 1', { lastSubmit: { outcome: 'verified', version: 2, at } })]), { state: 'todo', text: 'Agent 1: v2 verified: activate it on the Jivox tab.' })
eq('last submit failed / invalid / timeout → failed', ['failed', 'invalid', 'timeout'].map((o) => jivoxStep([agent('Agent 1', { lastSubmit: { outcome: o as never, version: null, at } })]).state), ['failed', 'failed', 'failed'])
eq('a failed re-submit does not hide an active version (still done)', jivoxStep([agent('Agent 1', { activeVersion: 1, lastSubmit: { outcome: 'failed', version: null, at } })]).state, 'done')
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
