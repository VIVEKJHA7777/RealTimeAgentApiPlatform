// Task 7.5: the Logs tab's pure helpers (frontend/src/lib/logs.ts): filters ⇄ the page address, what the
// API is asked, how a line reads (who, result, ids), switch lines, request-check lines, bodies, agent options.
//   cd frontend && npx tsx ../docs/test-scripts/phase-07-task-7.5-logs-lib.test.ts
import type { LogEntry, LogToken } from '../../frontend/src/lib/api-types.ts'
import {
  apiFilters, checkLine, entryIds, entryResult, filtersActive, filtersFromSearch, NO_FILTERS, prettyBody,
  searchFromFilters, showsSwitchLines, switchEventText, switchName, tokenOptions, whoLabel,
} from '../../frontend/src/lib/logs.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }

// ── filters ⇄ address ──
const f = filtersFromSearch(new URLSearchParams('status=failed&token=tok1&check=failed&switched=yes&id=%20SKU-1%20&since=1h&open=42'))
eq('address → filters (id trimmed)', f, { status: 'failed', token: 'tok1', check: 'failed', switched: 'yes', id: 'SKU-1', since: '1h' })
eq('nonsense values fall back to "no filter"', filtersFromSearch(new URLSearchParams('status=maybe&check=x&since=7d&switched=1')), NO_FILTERS)
eq('filters → address: only what is set, the open call kept', searchFromFilters({ ...NO_FILTERS, status: 'ok', since: '15m' }, new URLSearchParams('open=42&junk=1')).toString(), 'status=ok&since=15m&open=42')
eq('no filters → empty address (open kept)', searchFromFilters(NO_FILTERS, new URLSearchParams('open=7')).toString(), 'open=7')
const now = new Date('2026-10-12T10:00:00Z')
eq('API filters: the time window counts from now', apiFilters({ ...NO_FILTERS, since: '15m', token: 'none' }, now), { token: 'none', from: '2026-10-12T09:45:00.000Z' })
eq('  "any time" → no from', apiFilters(NO_FILTERS, now), {})
eq('active / switch lines shown', [filtersActive(NO_FILTERS), filtersActive({ ...NO_FILTERS, since: '1h' }), showsSwitchLines({ ...NO_FILTERS, since: '1h' }), showsSwitchLines({ ...NO_FILTERS, id: 'x' })], [false, true, true, false])

// ── one call ──
const base: LogEntry = {
  id: '10', kind: 'call', at: '2026-10-12T09:30:05.123Z', method: 'GET', path: '/v1/b/a?ids=S1,S2', status: 200, envelopeStatus: 'success',
  errorCodes: [], tokenKind: 'this_api', tokenId: 't1', tokenName: 'Jivox', header: 'x_api_key', idCount: 2, ids: ['S1', 'S2'], found: 2,
  durationMs: 4, switches: [], checkOk: true, ip: '1.2.3.4', userAgent: 'python-httpx/0.28.1', event: null,
}
const c = (o: Partial<LogEntry>) => ({ ...base, ...o })
const tokens: Record<string, LogToken> = { t1: { name: 'Jivox', hint: 'rtk_ab', revoked: false, agents: [{ id: 'a1', name: 'Agent 1' }] }, t2: { name: 'Old', hint: 'rtk_cd', revoked: true, agents: [] } }
eq('who: the agents using the token now (name in detail)', whoLabel(base, tokens), { text: 'Agent 1', detail: 'token "Jivox"', problem: false })
eq('who: a token without agents, revoked since', whoLabel(c({ tokenId: 't2', tokenName: 'Old' }), tokens), { text: 'Old', detail: 'revoked since', problem: false })
eq('who: a token not in the map → its name at the time', whoLabel(c({ tokenId: 't9', tokenName: 'Gone' }), tokens).text, 'Gone')
eq('who: problems', (['other_api', 'unknown', 'none'] as const).map((k) => whoLabel(c({ tokenKind: k, tokenId: null }), tokens)).map((w) => `${w.text}:${w.problem}`), ["another API's token:true", 'unknown token:true', 'no token:true'])
eq('result: all found / partial / none', [entryResult(base), entryResult(c({ found: 1 })), entryResult(c({ found: 0 }))], [{ text: '2 found', tone: 'ok' }, { text: '1 found · 1 not found', tone: 'partial' }, { text: '0 found · 2 not found', tone: 'fail' }])
eq('result: all found but a switch changed the answer → amber, never a clean success', entryResult(c({ switches: ['drop_id'] })), { text: '2 found', tone: 'partial' })
eq('result: a 200 the switches broke', [entryResult(c({ envelopeStatus: 'failure' })).text, entryResult(c({ envelopeStatus: null })).text], ['status "failure"', 'not JSON'])
eq('result: failures and a hung-up caller', [entryResult(c({ status: 401, errorCodes: ['UNAUTHORIZED'] })).text, entryResult(c({ status: 503, errorCodes: [] })).text, entryResult(c({ status: null })).text], ['UNAUTHORIZED', 'HTTP 503', 'Caller left before the answer'])
eq('ids: 2 · 12 (5 kept) → first 3 + 9 more · failed before ids', [entryIds(base), entryIds(c({ idCount: 12, ids: ['a', 'b', 'c', 'd', 'e'] })), entryIds(c({ idCount: null, ids: [] })), entryIds(c({ idCount: 0, ids: [] }))], ['S1, S2', 'a, b, c +9 more', '', 'no ids'])

// ── switches ──
eq('switch names with their options', [switchName('slow', { ms: 3500 }), switchName('wrong_type', { field: 'price' }), switchName('http_status', { status: 503 }), switchName('drop_id')], ['Slow answer (3 500 ms)', 'Wrong type (price)', 'HTTP status (503)', 'Drop an id'])
const at = (iso: string) => iso.slice(11, 16)
eq('switch line: on for one agent, until, own checks, by', switchEventText({ action: 'on', switch: 'drop_id', options: {}, scope: { tokenId: 't1', tokenName: 'Jivox' }, applyToOwnChecks: true, endsAt: '2026-10-12T11:00:00Z', by: 'v@jivox.com' }, tokens, at), 'Drop an id turned on for Agent 1 only, until 11:00, our own checks too, by v@jivox.com')
eq('switch line: changed for everyone', switchEventText({ action: 'changed', switch: 'slow', options: { ms: 5000 }, scope: null, applyToOwnChecks: false, endsAt: '2026-10-12T12:00:00Z', by: 'v@jivox.com' }, tokens, at), 'Slow answer (5 000 ms) changed for every caller, until 12:00, by v@jivox.com')
eq('switch line: ended by itself (no scope, no by)', switchEventText({ action: 'ended', switch: 'no_store', options: {}, scope: null, applyToOwnChecks: false, endsAt: '2026-10-12T12:00:00Z', by: null }, tokens, at), 'No "no-store" ended by itself')
eq('switch line: a token gone from the map → its name in quotes', switchEventText({ action: 'on', switch: 'extra_id', options: {}, scope: { tokenId: 'zz', tokenName: 'Agent 3 token' }, applyToOwnChecks: false, endsAt: '2026-10-12T12:00:00Z', by: null }, tokens, at), 'Extra id turned on for "Agent 3 token" only, until 12:00')

// ── request check lines ──
eq('check lines', [
  checkLine({ part: 'ids', name: 'ids', ok: true, got: '3' }),
  checkLine({ part: 'ids', name: 'ids', ok: true, got: '1' }),
  checkLine({ part: 'value', name: 'market', ok: false, expected: 'US', got: 'UK' }),
  checkLine({ part: 'value', name: 'market', ok: true, expected: 'US', got: 'US' }),
  checkLine({ part: 'value', name: 'market', ok: false, expected: 'US' }),
  checkLine({ part: 'context', name: 'locale (openai/locale)', ok: false }),
  checkLine({ part: 'column', name: 'items[].cat (category)', ok: false, got: 'missing in 2 of 3', missingFor: ['SKU-2', 'SKU-3'] }),
  checkLine({ part: 'method', name: 'method', ok: false, expected: 'POST', got: 'GET' }),
], ['ids: 3 ids', 'ids: 1 id', 'market: expected "US", got "UK"', 'market = "US"', 'market: missing (expected "US")', 'locale (openai/locale): missing', 'items[].cat (category): missing in 2 of 3 · SKU-2, SKU-3', 'Method: expected POST, got GET'])

// ── bodies + agent options ──
eq('bodies: pretty JSON · cut or not JSON shown as is · none', [prettyBody('{"a":1}', false), prettyBody('{"a":1', false), prettyBody('{"a":1}', true), prettyBody(null, false)], ['{\n  "a": 1\n}', '{"a":1', '{"a":1}', null])
eq('agent options: agents first by token, revoked last, then "no token"', tokenOptions(
  [{ id: 'old', name: 'Jivox', revokedAt: '2026-10-12T00:00:00Z' }, { id: 't1', name: 'Jivox', revokedAt: null }, { id: 't2', name: 'Spare', revokedAt: null }],
  [{ name: 'Agent 2', token: { id: 't1' } }, { name: 'Agent 1', token: { id: 't1' } }, { name: 'Draft', token: null }],
), [{ value: 't1', label: 'Agent 2, Agent 1 · Jivox' }, { value: 't2', label: 'Spare' }, { value: 'old', label: 'Jivox (revoked)' }, { value: 'none', label: 'No token of this API' }])

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
