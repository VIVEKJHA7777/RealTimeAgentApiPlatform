// Task 4.7: checks of the Test tab's pure helpers (frontend/src/lib/testing.ts): the ids box and the
// self-check's headline. No browser, no backend.
//   cd frontend && npx tsx ../docs/test-scripts/phase-04-task-4.7-testing-lib.test.ts
import { idsFromText, selfCheckVerdict } from '../../frontend/src/lib/testing.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }

// ids box
eq('empty / spaces → [] (server picks the first rows)', [idsFromText(''), idsFromText('  , ,\n ')], [{ ids: [] }, { ids: [] }])
eq('commas, spaces trimmed', idsFromText(' SKU-1 ,SKU-2,  SKU-3 '), { ids: ['SKU-1', 'SKU-2', 'SKU-3'] })
eq('one per line (pasted from a sheet), Windows line ends', idsFromText('SKU-1\r\nSKU-2\nSKU-3'), { ids: ['SKU-1', 'SKU-2', 'SKU-3'] })
eq('duplicates once, first-seen order', idsFromText('b, a, b, a'), { ids: ['b', 'a'] })
eq('spaces INSIDE an id are kept', idsFromText('Red Shoe 42, x'), { ids: ['Red Shoe 42', 'x'] })
eq('100 ids ok, 101 → error', [('ids' in idsFromText(Array.from({ length: 100 }, (_, i) => 'x' + i).join(','))), idsFromText(Array.from({ length: 101 }, (_, i) => 'x' + i).join(','))], [true, { error: 'At most 100 ids (you have 101)' }])
eq('id longer than 500 → error', 'error' in idsFromText('a'.repeat(501)), true)

// self-check headline
const c = (id: string, status: string, label = id) => ({ id, label, status, detail: '' })
const r = (mode: string, passed: boolean, checks: object[]) => ({ mode, url: 'u', ids: [], passed, checks, request: {}, response: null, durationMs: 1 }) as never
eq('live, all ✓ → Passed', selfCheckVerdict(r('live', true, [c('published', 'pass'), c('fast', 'pass')])).title, 'Passed')
eq('live, ✓ + ⚠ localhost → passed with a warning naming it', selfCheckVerdict(r('live', true, [c('reachable', 'warn', 'Reachable at http://localhost'), c('fast', 'pass')])), { tone: 'warn', title: 'Passed, with a warning', text: 'Reachable at http://localhost' })
eq('draft (in-app), only published/token ✗ → "answer looks right" (amber, says publish)', [selfCheckVerdict(r('in-app', false, [c('published', 'fail'), c('token', 'fail'), c('fields_typed', 'pass')])).tone, selfCheckVerdict(r('in-app', false, [c('published', 'fail')])).text.includes('Publish')], ['warn', true])
eq('content ✗ → red, counts and names them', selfCheckVerdict(r('live', false, [c('fields_typed', 'fail', 'Every field'), c('ids_once', 'fail', 'Every id'), c('fast', 'pass')])), { tone: 'fail', title: '2 checks failed', text: 'Every field · Every id' })
eq('draft with a content ✗ too → red (not the friendly draft message)', selfCheckVerdict(r('in-app', false, [c('published', 'fail'), c('fields_typed', 'fail', 'Every field')])).title, '2 checks failed')
eq('1 failure → singular', selfCheckVerdict(r('live', false, [c('fast', 'fail')])).title, '1 check failed')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
