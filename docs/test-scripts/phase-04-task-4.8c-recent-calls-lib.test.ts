// Task 4.8c: checks of the Recent calls card's pure helpers (frontend/src/lib/recent-calls.ts): how a
// recorded /v1 call reads (result, token, header, ids, body, duration, time). No browser, no backend.
//   cd frontend && npx tsx ../docs/test-scripts/phase-04-task-4.8c-recent-calls-lib.test.ts
import type { RecentCall } from '../../frontend/src/lib/api-types.ts'
import { bodyView, callResult, durationLabel, fullTimeLabel, headerLabel, idsLabel, timeLabel, tokenLabel } from '../../frontend/src/lib/recent-calls.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }
const base: RecentCall = {
  id: 'a1', at: '2026-10-12T09:30:05.123Z', method: 'POST', path: '/v1/b/a', status: 200, durationMs: 12.4,
  errorCode: null, errorMessage: null, tokenKind: 'this_api', tokenName: 'Jivox qa3', header: 'x_api_key',
  idCount: 2, ids: ['7', '8'], found: 2, body: '{"items":[{"id":"7"},{"id":"8"}]}', bodyBytes: 33, userAgent: 'Jivox/1', ip: '10.0.0.1',
}
const c = (o: Partial<RecentCall>) => ({ ...base, ...o })

// result
eq('200, all found → "2 found" ok', callResult(base), { text: '2 found', tone: 'ok' })
eq('200, 1 of 2 found → partial', callResult(c({ found: 1 })), { text: '1 found · 1 not found', tone: 'partial' })
eq('200, none found → fail', callResult(c({ found: 0 })), { text: '0 found · 2 not found', tone: 'fail' })
eq('failure → its code', callResult(c({ status: 401, errorCode: 'TOKEN_EXPIRED', idCount: null, found: null })), { text: 'TOKEN_EXPIRED', tone: 'fail' })
eq('failure without a code → HTTP n', callResult(c({ status: 502, errorCode: null })).text, 'HTTP 502')
eq('caller hung up → says so', callResult(c({ status: null })), { text: 'Caller left before the answer', tone: 'fail' })

// token + header
eq('token kinds', (['this_api', 'other_api', 'unknown', 'not_checked', 'none'] as const).map((k) => tokenLabel(c({ tokenKind: k, tokenName: k === 'this_api' ? 'Jivox qa3' : null }))),
  [{ text: 'Jivox qa3', problem: false }, { text: "another API's token", problem: true }, { text: 'unknown token', problem: true }, { text: 'token not checked', problem: false }, { text: 'no token', problem: true }])
eq('header labels', [headerLabel(base), headerLabel(c({ header: 'bearer' })), headerLabel(c({ header: null }))], ['X-Api-Key', 'Authorization: Bearer', 'no token header'])

// ids
eq('2 ids', idsLabel(base), '7, 8')
eq('12 ids (10 kept) → first 3 + 9 more', idsLabel(c({ idCount: 12, ids: Array.from({ length: 10 }, (_, i) => `S${i}`) })), 'S0, S1, S2 +9 more')
eq('failed before ids (row shows the token only) / no ids', [idsLabel(c({ idCount: null, ids: [] })), idsLabel(c({ idCount: 0, ids: [] }))], ['', 'no ids'])

// body
eq('JSON body → pretty, no note', bodyView(base), { text: '{\n  "items": [\n    {\n      "id": "7"\n    },\n    {\n      "id": "8"\n    }\n  ]\n}', note: null })
eq('invalid JSON → exactly as sent', bodyView(c({ body: '{"items": [', bodyBytes: 11 })), { text: '{"items": [', note: null })
eq('cut body → as sent (not re-formatted), with a note', bodyView(c({ body: 'x'.repeat(2048), bodyBytes: 5038 })), { text: 'x'.repeat(2048), note: 'First 2 KB of 4.9 KB shown.' })
eq('multi-byte text counted in bytes (not cut)', bodyView(c({ body: '"é"', bodyBytes: 4 }))?.note, null)
eq('too large, not kept → note only', bodyView(c({ body: null, bodyBytes: 1100000 })), { text: '', note: 'Body of 1.0 MB not kept (too large to read).' })
eq('GET, no body → nothing', bodyView(c({ body: null, bodyBytes: 0 })), null)

// duration + time
eq('durations', [durationLabel(12.4), durationLabel(0.4), durationLabel(1234)], ['12 ms', '0.4 ms', '1.2 s'])
const at = new Date(2026, 9, 12, 14, 2, 31)
eq('today → time with seconds', timeLabel(at.toISOString(), new Date(2026, 9, 12, 18)), '14:02:31')
eq('another day → date + time', timeLabel(at.toISOString(), new Date(2026, 9, 13, 9)), '12 Oct, 14:02:31')

eq('details time has seconds', fullTimeLabel(at.toISOString()), '12 Oct 2026, 14:02:31')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
