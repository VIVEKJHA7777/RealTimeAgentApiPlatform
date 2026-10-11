// Task 5.6: checks of the pure parts behind "out of date" and the design-save warning:
//   contract-shape.ts  (shape = document without samples, canonical JSON / hash, changes in words)
//   contract.ts        (shapeFor / contractState: today's shape without data, out of date or not)
//   design-impact.ts   (fields a design save takes away from agents, confirmations, changed contracts)
// No database, no HTTP.
//   cd backend && npx tsx ../docs/test-scripts/phase-05-task-5.6-shape-lib.test.ts
import { buildContract, contractState, type ShapeContext, shapeFor } from '../../backend/src/modules/apis/agents/contract.ts';
import { canonicalJson, contractShape, MAX_CHANGES, sameShape, shapeChanges, shapeHash } from '../../backend/src/modules/apis/agents/contract-shape.ts';
import { changedContracts, droppedAgentFields, unconfirmed } from '../../backend/src/modules/apis/agents/design-impact.ts';

let pass = 0, fail = 0;
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`); };

const field = (jivoxColumn: string, responseKey: string, type = 'string', extra: Record<string, unknown> = {}) =>
  ({ jivoxColumn, sourceColumn: jivoxColumn, responseKey, type, typeInContract: true, default: '', onMismatch: 'send', onEmpty: 'empty_string', ...extra });
const GET = { method: 'GET', query: { ids: '{item_id}' }, maxIdsPerCall: 100 };
const design = (fields: ReturnType<typeof field>[], request: Record<string, unknown> = GET, idKey = 'id') => ({ idField: { responseKey: idKey }, fields, request }) as never;
const ctx = (d: unknown, extra: Partial<ShapeContext> = {}): ShapeContext => ({
  feedType: 'product', apiSlug: 'price-api', brandSlug: 'acme', publicBaseUrl: 'https://platform.example', authHeader: 'x_api_key',
  design: d as never, request: ((d as { request: unknown }).request) as never, ...extra,
});
const D1 = design([field('sub_title', 'subkey'), field('current_price', 'price', 'float'), field('currency', 'cur')]);
const agentA = { id: 'a', name: 'axas · Agent 1', fields: ['sub_title'], agentInfo: null };
const agentB = { id: 'b', name: 'mswfeed18 · Agent 1', fields: ['current_price', 'currency'], agentInfo: null };

// ── shape ──
const full = buildContract({ ...ctx(D1), agent: { fields: ['sub_title'], info: null }, sample: { query: { ids: 'SKU-1,SKU-2' } }, answer: { status: 200, body: { status: 'success', data: [{ id: 'SKU-1' }] } }, sampleIds: ['SKU-1'] }).document;
const shape = contractShape(full);
eq('shape = document without response + sample_request', Object.keys(shape), Object.keys(full).filter((k) => k !== 'response' && k !== 'sample_request'));
eq('shapeFor (no data at all) = the shape of the real document', canonicalJson(shapeFor(ctx(D1), agentA)), canonicalJson(shape));
eq('new data (other sample answer) → same shape', sameShape(contractShape({ ...full, response: { data: [{ id: 'X' }] }, sample_request: { ids: 'X' } }), shape), true);
eq('canonical JSON ignores key order (JSONB reorders), keeps list order', [canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson([2, 1])], ['{"a":{"c":3,"d":2},"b":1}', '[2,1]']);
eq('hash: same shape any key order → same; differs when a value differs', [shapeHash({ x: 1, y: [1] }) === shapeHash({ y: [1], x: 1 }), shapeHash({ x: 1 }) === shapeHash({ x: 2 }), shapeHash(shape).length], [true, false, 64]);

// ── changes in words ──
const S = (d: unknown, a: { fields: string[]; agentInfo: unknown } = agentA, extra: Partial<ShapeContext> = {}) => shapeFor(ctx(d, extra), a);
eq('same → no changes', shapeChanges(S(D1), S(D1)), []);
eq('field removed / added', [shapeChanges(S(D1, { fields: ['sub_title', 'currency'], agentInfo: null }), S(D1)), shapeChanges(S(D1), S(D1, { fields: ['sub_title', 'currency'], agentInfo: null }))], [['currency removed'], ['currency added']]);
eq('response key renamed', shapeChanges(S(D1), S(design([field('sub_title', 'sub')]))), ['sub_title: key subkey → sub']);
eq('type changed / left to Jivox / back', [
  shapeChanges(S(design([field('sub_title', 'subkey')])), S(design([field('sub_title', 'subkey', 'string', { typeInContract: false })]))),
  shapeChanges(S(design([field('sub_title', 'subkey', 'string', { typeInContract: false })])), S(design([field('sub_title', 'subkey')]))),
], [['sub_title: type left to Jivox (was string)'], ['sub_title: type string (was left to Jivox)']]);
const priceAgent = { fields: ['current_price'], agentInfo: null };
eq('type: contract keeps Jivox\'s type, so a design type change alone does NOT change the contract', shapeChanges(S(D1, priceAgent), S(design([field('current_price', 'price', 'string')]), priceAgent)), []);
eq('default changed', shapeChanges(S(D1), S(design([field('sub_title', 'subkey', 'string', { default: 'n/a' })]))), ['sub_title: default "" → n/a']);
eq('id key renamed', shapeChanges(S(D1), S(design([field('sub_title', 'subkey')], GET, 'sku'))), ['Id item_id: key id → sku']);
const POST = { method: 'POST', body: { items: [{ id: '{item_id}' }] }, maxIdsPerCall: 100 };
eq('GET → POST', shapeChanges(S(D1), S(design([field('sub_title', 'subkey')], POST))), ['Request: GET → POST']);
eq('query template changed (same method)', shapeChanges(S(D1), S(design([field('sub_title', 'subkey')], { ...GET, query: { ids: '{item_id}', market: 'US' } }))), ['Request template changed (query)']);
eq('max ids per call', shapeChanges(S(D1), S(design([field('sub_title', 'subkey')], { ...GET, maxIdsPerCall: 50 }))), ['Max ids per call: 100 → 50']);
eq('API renamed → address', shapeChanges(S(D1), S(D1, agentA, { apiSlug: 'price-api-2' })), ['Address: https://platform.example/v1/acme/price-api → https://platform.example/v1/acme/price-api-2']);
eq('header style → Bearer', shapeChanges(S(D1), S(D1, agentA, { authHeader: 'bearer' })), ['Token header: X-Api-Key: {token} → Authorization: Bearer {token}']);
const two = { fields: ['current_price', 'currency'], agentInfo: null };
eq('design order of two agent fields swapped', shapeChanges(S(D1, two), S(design([field('currency', 'cur'), field('current_price', 'price', 'float')]), two)), ['Fields in another order']);
eq('an unknown top-level key → named, never "no changes"', shapeChanges({ ...shape }, { ...shape, extra_rule: 1 }), ['extra_rule changed']);
const many = Array.from({ length: 30 }, (_, i) => field(`f${i}`, `k${i}`));
eq(`many changes → at most ${MAX_CHANGES} lines, the last "and N more"`, (() => { const c = shapeChanges(S(design(many), { fields: many.map((f) => f.jivoxColumn), agentInfo: null }), S(design([]), { fields: [], agentInfo: null })); return [c.length, c.at(-1)]; })(), [MAX_CHANGES, 'and 11 more']);

// ── contractState ──
const row = (shapeTaken: unknown) => ({ lastContractAt: shapeTaken ? new Date('2026-10-12T10:00:00Z') : null, lastContractHow: shapeTaken ? 'copy' : null, lastContractDesignVersion: shapeTaken ? 5 : null, lastContractShape: shapeTaken as never });
eq('never taken → last null, outOfDate null', contractState(row(null), S(D1)), { last: null, outOfDate: null, changes: [] });
eq('taken, unchanged → up to date', contractState(row(S(D1)), S(D1)).outOfDate, false);
eq('taken, stored with other key order (JSONB) → still up to date', contractState(row(JSON.parse(canonicalJson(S(D1)))), S(D1)).outOfDate, false);
eq('taken, then a field renamed → out of date + why', (({ outOfDate, changes }) => ({ outOfDate, changes }))(contractState(row(S(D1)), S(design([field('sub_title', 'sub')])))), { outOfDate: true, changes: ['sub_title: key subkey → sub'] });
eq('taken, but no design now → unknown (null), last kept', (({ last, outOfDate }) => [last?.designVersion, outOfDate])(contractState(row(S(D1)), null)), [5, null]);

// ── design impact ──
const D2 = design([field('current_price', 'price', 'float')]); // sub_title + currency removed
eq('dropped: per agent, the fields it loses + how many it keeps', droppedAgentFields(D1, D2, [agentA, agentB]), [
  { id: 'a', name: 'axas · Agent 1', fields: ['sub_title'], left: 0 },
  { id: 'b', name: 'mswfeed18 · Agent 1', fields: ['currency'], left: 1 },
]);
eq('first save (no old design) → nothing dropped', droppedAgentFields(null, D2, [agentA]), []);
eq('field already missing before → not asked again', droppedAgentFields(D2, design([field('current_price', 'p2', 'float')]), [agentA]), []);
eq('Jivox field of a row changed (sub_title → description) = sub_title dropped', droppedAgentFields(D1, design([field('description', 'subkey'), field('current_price', 'price', 'float'), field('currency', 'cur')]), [agentA]).map((d) => d.fields), [['sub_title']]);
eq('response key / type changes drop nothing', droppedAgentFields(D1, design([field('sub_title', 'other', 'int'), field('current_price', 'p', 'string'), field('currency', 'c')]), [agentA, agentB]), []);
const dropped = droppedAgentFields(D1, D2, [agentA, agentB]);
eq('confirmations: all → none left; partial / other agent / stale → still asked', [
  unconfirmed(dropped, [{ agentId: 'a', field: 'sub_title' }, { agentId: 'b', field: 'currency' }]).length,
  unconfirmed(dropped, [{ agentId: 'a', field: 'sub_title' }]).map((d) => d.id),
  unconfirmed(dropped, [{ agentId: 'b', field: 'sub_title' }, { agentId: 'a', field: 'currency' }]).length,
  unconfirmed(dropped, []).length,
], [0, ['b'], 2, 2]);
eq('changed contracts: who + why; unaffected agent not listed', changedContracts(ctx(D1), ctx(design([field('sub_title', 'sub'), field('current_price', 'price', 'float'), field('currency', 'cur')])), [agentA, agentB]), [{ id: 'a', name: 'axas · Agent 1', changes: ['sub_title: key subkey → sub'] }]);
eq('changed contracts: first save → none (nothing existed)', changedContracts(null, ctx(D1), [agentA]), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
