// Task 5.5: checks of the Jivox tab's pure helpers (frontend/src/lib/agents.ts): the agent form
// (validation, exactly what an edit sends, the write-only key), sample ids, the checklist's groups,
// summary and fix links, and the fields one can pick by hand. No browser, no backend.
//   cd frontend && npx tsx ../docs/test-scripts/phase-05-task-5.5-agents-lib.test.ts
import { agentInput, checkSummary, fixTarget, formFromAgent, groupChecks, mcpHost, mcpUrlProblem, parseSampleIds, pickableFields, shouldReadAfterSave, validateAgentForm } from '../../frontend/src/lib/agents.ts'
import type { Agent, AgentCheck } from '../../frontend/src/lib/api-types.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }

const agent: Agent = {
  id: 'a1', name: 'axas · Agent 1', brandstore: 'axas-c63e9', fields: ['sub_title'], sampleIds: ['SKU-1', 'SKU-2'],
  token: { id: 't1', name: 'Jivox axas', hint: 'rtk_ZiL9', state: 'active' }, mcpUrl: 'https://brandstore-data-mcp.qa3.jivox.com/mcp',
  accessKey: { hint: 'Rm', readable: true }, jivox: null, lastError: null, createdAt: '', updatedAt: '',
}

// ── form ──
const f0 = formFromAgent(agent)
eq('form from an agent: key box EMPTY (write-only), samples joined', [f0.accessKey, f0.removeKey, f0.sampleIdsText, f0.tokenId], ['', false, 'SKU-1, SKU-2', 't1'])
eq('form from a revoked-token agent → no token selected', formFromAgent({ ...agent, token: { ...agent.token!, state: 'revoked' } }).tokenId, '')
eq('new-agent form is empty', formFromAgent(null), { name: '', brandstore: '', mcpUrl: '', accessKey: '', removeKey: false, tokenId: '', fields: [], sampleIdsText: '' })

// ── validation (same rules as the server) ──
const v = (patch: Partial<typeof f0>) => validateAgentForm({ ...formFromAgent(null), name: 'A', ...patch })
eq('valid minimal form → no errors', v({}), {})
eq('name: blank / 61 chars', [v({ name: '  ' }).name, v({ name: 'x'.repeat(61) }).name], ['Name is required', 'Name can be at most 60 characters'])
eq('MCP URL: https ok, http only for localhost, user:pw@ refused, junk refused', [mcpUrlProblem('https://x.example/mcp'), mcpUrlProblem('http://127.0.0.1:4791/ok'), mcpUrlProblem('http://example.com/mcp') !== null, mcpUrlProblem('https://u:p@x.example/mcp') !== null, mcpUrlProblem('not a url') !== null, mcpUrlProblem('')], [null, null, true, true, true, null])
eq('key: short / with spaces → errors; empty = keep', [v({ accessKey: 'abc' }).accessKey !== undefined, v({ accessKey: 'has space here' }).accessKey, v({ accessKey: '' }).accessKey], [true, 'An access key has no spaces', undefined])
eq('sample ids: commas or new lines, trimmed, each once; 11 → error', [parseSampleIds(' SKU-1,SKU-2\nSKU-1 ,, '), v({ sampleIdsText: Array.from({ length: 11 }, (_, i) => `S${i}`).join(',') }).sampleIds], [{ ids: ['SKU-1', 'SKU-2'] }, 'At most 10 sample ids'])

// ── what is sent ──
eq('new agent → everything; key only when typed', [agentInput({ ...formFromAgent(null), name: ' A ', mcpUrl: 'https://x/mcp' }, null), 'accessKey' in agentInput({ ...formFromAgent(null), name: 'A', accessKey: 'k123456789' }, null)], [{ name: 'A', brandstore: null, mcpUrl: 'https://x/mcp', tokenId: null, fields: [], sampleIds: [] }, true])
eq('edit with nothing changed → {} (the dialog just closes)', agentInput(f0, agent), {})
eq('edit: only the name → only { name }', agentInput({ ...f0, name: 'renamed' }, agent), { name: 'renamed' })
eq('edit: clear brandstore + sample ids', agentInput({ ...f0, brandstore: '', sampleIdsText: '' }, agent), { brandstore: null, sampleIds: [] })
eq('edit: a new key → sent; "remove" → null; neither → absent', [agentInput({ ...f0, accessKey: 'newkey12345' }, agent), agentInput({ ...f0, removeKey: true }, agent), 'accessKey' in agentInput({ ...f0, name: 'x' }, agent)], [{ accessKey: 'newkey12345' }, { accessKey: null }, false])
eq('edit: unlink token / change fields order counts as a change', [agentInput({ ...f0, tokenId: '' }, agent), agentInput({ ...f0, fields: ['sub_title', 'currency'] }, agent)], [{ tokenId: null }, { fields: ['sub_title', 'currency'] }])
eq('read after save only when the URL or key changed (and both are set)', [shouldReadAfterSave({ mcpUrl: 'https://y/mcp' }, agent), shouldReadAfterSave({ accessKey: 'k' }, agent), shouldReadAfterSave({ name: 'x' }, agent), shouldReadAfterSave({ accessKey: null }, { ...agent, accessKey: null })], [true, true, false, false])

// ── checklist ──
const result = (statuses: Record<string, 'pass' | 'fail' | 'warn' | 'skip'>): AgentCheck => ({
  agent: { id: 'a1', name: 'x' }, ready: !Object.values(statuses).includes('fail'), document: {} as never, sample: { ids: [], request: {} as never, response: { status: 200, body: {} }, live: true },
  checks: Object.entries(statuses).map(([id, status], i) => ({ id, group: (['agent', 'contract', 'token', 'live'] as const)[i % 4], label: id, status, detail: '' })),
})
eq('summary: not checked / ready (+ warnings) / N to fix', [checkSummary(undefined).text, checkSummary(result({ a: 'pass', b: 'warn' })), checkSummary(result({ a: 'fail', b: 'fail', c: 'pass' })).text], ['Not checked', { text: 'Ready', tone: 'ok', warnings: 1 }, '2 to fix'])
eq('groups in order agent → contract → token → live, empty groups dropped', groupChecks(result({ a: 'pass', b: 'pass', c: 'pass' }).checks).map((g) => g.label), ['Jivox agent', 'Contract', 'Token'])
const base = '/brands/b/apis/a'
eq('fix links: design / tokens (Test tab) / publish (Overview) / data; agent → Edit; studio + settings → text only', ['design', 'tokens', 'publish', 'data', 'agent', 'studio', 'settings'].map((p) => fixTarget(p as never, base)), [{ to: `${base}/design` }, { to: `${base}/test` }, { to: base }, { to: `${base}/data` }, { action: 'edit' }, null, null])

// ── small ones ──
eq('MCP host', [mcpHost('https://brandstore-data-mcp.qa3.jivox.com/mcp'), mcpHost(null)], ['brandstore-data-mcp.qa3.jivox.com', null])
eq('fields to pick: design fields minus the id and mandatory ones, plus the agent\'s own others', pickableFields(['item_id', 'product_name', 'current_price', 'sub_title'], 'item_id', new Set(['item_id', 'product_name', 'product_image']), ['currency']), ['current_price', 'sub_title', 'currency'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
