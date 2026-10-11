// Task 3.7: checks of the Design tab's pure helpers (frontend/src/lib/design.ts): request form ⇄ JSON,
// GET ⇄ POST conversion, name matching, key / type suggestions. No browser, no backend needed.
//   cd frontend && npx tsx ../docs/test-scripts/phase-03-task-3.7-design-lib.test.ts
import { getFormOf, postFormOf, buildGetQuery, buildPostBody, postFromGet, getFromPost, matchColumn, suggestKey, uniqueKey, suggestType, castLiteral } from '../../frontend/src/lib/design.ts'
let pass = 0, fail = 0
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`) }
const I = 'item_id'
// GET form roundtrip
const g = { method: 'GET' as const, query: { ids: '{item_id}', market: 'US', limit: 5, debug: true, locale: '{_meta.openai/locale}' }, maxIdsPerCall: 100 }
const gf = getFormOf(g, I)!
eq('GET form: ids param', gf.idsParam, 'ids')
eq('GET form: literals keep their types', gf.literals.map(l => l.value), ['US', 5, true])
eq('GET form: context', gf.context.map(c => [c.key, c.source]), [['locale', '_meta.openai/locale']])
eq('GET build = original (any key order)', Object.keys(buildGetQuery(gf, I)).sort(), Object.keys(g.query).sort())
eq('GET with {category} (POST only) → JSON editor', getFormOf({ method: 'GET', query: { ids: '{item_id}', c: '{category}' }, maxIdsPerCall: 100 }, I), null)
eq('GET with two ids → JSON editor', getFormOf({ method: 'GET', query: { a: '{item_id}', b: '{item_id}' }, maxIdsPerCall: 100 }, I), null)
eq('GET without ids → JSON editor', getFormOf({ method: 'GET', query: { a: 'x' }, maxIdsPerCall: 100 }, I), null)
// POST form roundtrip (Sample B)
const p = { method: 'POST' as const, body: { items: [{ sku: '{item_id}', cat: '{category}', loc: '{_meta.openai/locale}', n: 7 }], context: { locale: '{_meta.openai/locale}', location: '{_meta.openai/userLocation}' }, currency: 'USD', include_promotions: true }, maxIdsPerCall: 50 }
const pf = postFormOf(p, I)!
eq('POST form: rows key / id key', [pf.rowsKey, pf.idKey], ['items', 'sku'])
eq('POST form: row entries', pf.row.map(r => [r.key, r.kind]), [['cat', 'column'], ['loc', 'context'], ['n', 'literal']])
eq('POST form: extras as dotted paths', pf.extras.map(x => x.path), ['context.locale', 'context.location', 'currency', 'include_promotions'])
eq('POST build = original', buildPostBody(pf, I), p.body)
eq('POST body is a list → JSON editor', postFormOf({ method: 'POST', body: [{ id: '{item_id}' }], maxIdsPerCall: 100 }, I), null)
eq('POST with null / list literal / {} → JSON editor', [postFormOf({ method: 'POST', body: { items: [{ id: '{item_id}' }], x: null }, maxIdsPerCall: 100 }, I), postFormOf({ method: 'POST', body: { items: [{ id: '{item_id}' }], x: [1] }, maxIdsPerCall: 100 }, I), postFormOf({ method: 'POST', body: { items: [{ id: '{item_id}' }], x: {} }, maxIdsPerCall: 100 }, I)], [null, null, null])
eq('POST nested rows (data.rows) → JSON editor', postFormOf({ method: 'POST', body: { data: { rows: [{ id: '{item_id}' }] } }, maxIdsPerCall: 100 }, I), null)
eq('POST key with a dot → JSON editor', postFormOf({ method: 'POST', body: { items: [{ id: '{item_id}' }], 'a.b': 1 }, maxIdsPerCall: 100 }, I), null)
// conversions
eq('GET → POST: literals and context carried over', postFromGet(gf, I), { items: [{ id: '{item_id}' }], market: 'US', limit: 5, debug: true, locale: '{_meta.openai/locale}' })
const back = getFromPost(pf, I)
eq('POST → GET: per-row {category} and literal n dropped (reported)', back.dropped, ['cat', 'n'])
eq('POST → GET: query', back.query, { ids: '{item_id}', currency: 'USD', include_promotions: true, context_locale: '{_meta.openai/locale}', context_location: '{_meta.openai/userLocation}' })
// suggestions
eq('matchColumn: currentPrice ↔ current_price, Current-Price, CURRENT PRICE', ['currentPrice', 'Current-Price', 'CURRENT PRICE'].map(c => matchColumn('current_price', [c])), ['currentPrice', 'Current-Price', 'CURRENT PRICE'])
eq('matchColumn: no guess (price ≠ current_price)', matchColumn('current_price', ['price', 'priceUSD']), null)
eq('suggestKey', ['Product Title', 'price€', '  ', 'a..b'].map(suggestKey), ['Product_Title', 'price', 'field', 'a_b'])
eq('uniqueKey ignores case', uniqueKey('Price', ['price', 'price_2']), 'Price_3')
const info = (candidates: string[]) => ({ name: 'x', isId: false, filled: 10, empty: 0, fits: { int: 0, float: 0, boolean: 0, image: 0 }, candidates, suggestedType: candidates[0] ?? null, examples: [] }) as never
eq('suggestType: hint allowed → hint (1/0 column + is_active)', suggestType(info(['int', 'float', 'boolean', 'string']), 'boolean'), 'boolean')
eq('suggestType: hint not allowed → best fit', suggestType(info(['string']), 'float'), 'string')
eq('suggestType: empty column → hint', suggestType(info([]), 'image'), 'image')
eq('castLiteral', [castLiteral('12', 'number'), castLiteral('abc', 'number'), castLiteral('TRUE', 'boolean'), castLiteral(5, 'text')], [12, 0, true, '5'])
console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
