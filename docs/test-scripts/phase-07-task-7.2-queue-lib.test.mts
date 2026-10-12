// Task 7.2: the call log's queue and request check, without a database. The queue is driven with a FAKE writer
// (useCallLogWriter), so "database unreachable", "API deleted meanwhile" and "a row the table refuses" can be
// tested without stopping Postgres. Plus request-check edge cases and the size limit of a huge check.
//   cd backend && npx tsx ../docs/test-scripts/phase-07-task-7.2-queue-lib.test.mts
import { buildCallLogRow, callLogWaiting, flushCallLogsNow, logCall, useCallLogWriter } from '../../backend/src/modules/v1/call-log.ts'
import type { CallLogRow } from '../../backend/src/modules/v1/call-log-store.ts'
import { checkCall } from '../../backend/src/modules/v1/request-check.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }

// ── A call, as recent-calls.ts hands it over ──
const headers: Record<string, string> = { host: 'x', 'user-agent': 'python-httpx/0.28.1' }
const call = (n: number, apiId = 'api-1') => {
  const req: any = { method: 'GET', originalUrl: `/v1/b/a?ids=S${n}`, query: { ids: `S${n}` }, headers, ip: '1.2.3.4', get: (h: string) => headers[h.toLowerCase()] }
  const res: any = { locals: { v1Body: { status: 'success', errors: [] }, v1Sent: '{}' }, headersSent: true, writableFinished: true, statusCode: 200, getHeaders: () => ({ 'cache-control': 'no-store' }) }
  const note: any = { at: new Date(), started: process.hrtime.bigint(), tokenKind: 'this_api', tokenName: 't', header: 'x_api_key', ids: [`S${n}`], found: 1, bodyBytes: 0 }
  return [req, res, note, apiId] as const
}
const n = (row: CallLogRow) => Number(String(row.path).split('S')[1])
let written: CallLogRow[] = []
const ok = async (rows: CallLogRow[]) => { written.push(...rows); return rows.length }
const away = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432') }

// 1. Database unreachable twice, then back
let calls = 0
useCallLogWriter(async (rows) => (++calls <= 2 ? away() : ok(rows)))
for (let i = 1; i <= 3; i++) logCall(...call(i))
eq('3 calls → 3 waiting (nothing written while answering)', [callLogWaiting(), written.length], [3, 0])
await flushCallLogsNow()
eq('unreachable twice, then back → all 3 written, in order', [written.map(n), callLogWaiting(), calls], [[1, 2, 3], 0, 3])

// 2. Away for long: at most 5 000 wait, the OLDEST go first
written = []; useCallLogWriter(away)
for (let i = 1; i <= 5100; i++) logCall(...call(i))
eq('5 100 calls while away → 5 000 waiting', callLogWaiting(), 5000)
await flushCallLogsNow()
eq('  a shutdown while away returns (doesn\'t hang) and keeps them waiting', callLogWaiting(), 5000)
useCallLogWriter(ok); await flushCallLogsNow()
eq('  back → the newest 5 000 written (S101…S5100), in batches of 250', [written.length, n(written[0]), n(written.at(-1)!), callLogWaiting()], [5000, 101, 5100, 0])

// 3. A batch refused: the API was deleted meanwhile / a row breaks a table rule → only those dropped
written = []
useCallLogWriter(async (rows) => {
  if (rows.length > 1 && rows.some((r) => r.apiId !== 'api-1' || n(r) === 3)) throw new Error('insert failed')
  if (rows[0].apiId === 'gone') throw new Error('violates foreign key constraint "api_call_logs_api_id_fkey" (23503)')
  if (n(rows[0]) === 3) throw new Error('new row violates check constraint "api_call_logs_sizes" (23514)')
  return ok(rows)
})
logCall(...call(1)); logCall(...call(2, 'gone')); logCall(...call(3)); logCall(...call(4))
await flushCallLogsNow()
eq('a deleted API\'s entry + a refused entry dropped; the others written', [written.map(n), callLogWaiting()], [[1, 4], 0])

// 4. The database goes away DURING the one-by-one writes → the rest waits again, in order
written = []; calls = 0
useCallLogWriter(async (rows) => {
  calls++
  if (rows.length > 1) throw new Error('violates foreign key constraint (23503)')
  if (n(rows[0]) === 2 && calls < 5) return away()
  return ok(rows)
})
logCall(...call(1)); logCall(...call(2)); logCall(...call(3))
await flushCallLogsNow()
eq('one-by-one: S1 written, then away → S2, S3 wait and are written next, in order', [written.map(n), callLogWaiting()], [[1, 2, 3], 0])

// 5. logCall never throws (the answer has gone out; a broken entry is only a warning)
const [req, res, note, apiId] = call(9); res.getHeaders = () => { throw new Error('boom') }
let threw = false; try { logCall(req, res, note, apiId) } catch { threw = true }
eq('a broken entry → no throw, nothing queued', [threw, callLogWaiting()], [false, 0])

// ── Request check edge cases ──
const GET = { method: 'GET' as const, query: { ids: '{item_id}', n: 5, flag: true }, maxIdsPerCall: 25 }
const GS = { method: 'GET' as const, idParam: 'ids', context: [] }
eq('GET ?ids=a&ids=b,c (repeated) → 3 ids; literals compared as text (5, true)', checkCall(GET, GS, 'GET', { ids: ['a', 'b,c'], n: '5', flag: 'true' }, undefined).check,
  { ok: true, items: [{ part: 'ids', name: 'ids', ok: true, got: '3' }, { part: 'value', name: 'n', ok: true, expected: '5', got: '5' }, { part: 'value', name: 'flag', ok: true, expected: 'true', got: 'true' }], extra: [] })
eq('GET ids all empty (?ids=,,) → ids ✗ got 0', checkCall(GET, GS, 'GET', { ids: ',,', n: '5', flag: 'true' }, undefined).check.items[0], { part: 'ids', name: 'ids', ok: false, got: '0' })
const LIST = { method: 'POST' as const, body: [{ id: '{item_id}', qty: 1 }], maxIdsPerCall: 25 }
const LS = { method: 'POST' as const, rowsPath: [], idKey: 'id', columns: [], context: [] }
eq('POST, the body itself is the list: qty 1 vs "1" (text) → ✗ for that row', checkCall(LIST, LS, 'POST', {}, [{ id: 'A', qty: 1 }, { id: 'B', qty: '1' }]).check,
  { ok: false, items: [{ part: 'ids', name: '[].id', ok: true, got: '2' }, { part: 'value', name: '[].qty', ok: false, expected: '1', missingFor: ['B'], got: 'missing in 1 of 2' }], extra: [] })
eq('POST, body not a list → ids ✗ got 0 (and no crash)', checkCall(LIST, LS, 'POST', {}, { items: 'x' }).check.items[0], { part: 'ids', name: '[].id', ok: false, got: '0' })
eq('POST, a row without its id → ids ✗; named "row 2"', checkCall(LIST, LS, 'POST', {}, [{ id: 'A', qty: 1 }, { qty: 2 }]).check.items.map((i) => [i.ok, i.missingFor]), [[false, null], [false, ['row 2']]])

// A huge check is cut to fit the table (8 KB): fewer rows named first, then fewer items
const cols = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, '{category}']))
const big = { method: 'POST' as const, body: { items: [{ sku: '{item_id}', ...cols }] }, maxIdsPerCall: 100 }
const bigSummary = { method: 'POST' as const, rowsPath: ['items'], idKey: 'sku', columns: [], context: [] }
const [r2, s2, n2] = call(1)
Object.assign(r2, { method: 'POST', query: {}, body: { items: Array.from({ length: 100 }, (_, i) => ({ sku: `${'X'.repeat(90)}-${i}` })) } })
n2.template = { request: big, summary: bigSummary }
const row = buildCallLogRow(r2, s2, n2, 'api-1') as any
eq('40 columns missing in 100 rows of long ids (≈ 40 KB) → under 7 KB, marked cut short, still ✗', [Buffer.byteLength(JSON.stringify(row.requestCheck)) <= 7000, row.requestCheck.cutShort, row.requestCheck.ok], [true, true, false])

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
