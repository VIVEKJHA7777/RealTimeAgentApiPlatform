// Task 5.3: checks of the contract generator's pure part (backend/src/modules/apis/agents/contract.ts →
// buildContract). The strongest check: fed the designs behind Jivox's OWN two samples (from the qa3
// MCP snapshot, task 5.0), it must produce Jivox's documents exactly (only base_url + path are ours).
// Then: the user's mapping example, groups, notes, types, file names. No browser, no HTTP.
//   cd backend && npx tsx ../docs/test-scripts/phase-05-task-5.3-contract-lib.test.ts
import { readFileSync } from 'node:fs';
import { buildContract, contractFileName, type ContractInput } from '../../backend/src/modules/apis/agents/contract.ts';
import { buildSampleRequest } from '../../backend/src/modules/apis/design/build-response.ts';
import { checkRequest } from '../../backend/src/modules/apis/design/request-rules.ts';
import { getFeedSchema } from '../../backend/src/modules/jivox/feed-schemas.ts';

let pass = 0, fail = 0;
const eq = (name: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : fail++; console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`}`); };
const spec = JSON.parse(readFileSync(new URL('../jivox/mcp-snapshot-2026-10-12/get_contract_spec.json', import.meta.url), 'utf8'));
const [sampleA, sampleB] = spec.examples.map((e: { contract: Record<string, unknown> }) => e.contract);
const PUB = 'https://platform.example';
const field = (jivoxColumn: string, responseKey: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ jivoxColumn, sourceColumn: jivoxColumn, responseKey, type, typeInContract: true, default: '', onMismatch: 'send', onEmpty: 'empty_string', ...extra });
// The sample request exactly as our Try it / self-check build it (same function), from the template.
const sampleOf = (request: never, ids: string[], col: (id: string, c: string) => string = () => '') => {
  const { summary } = checkRequest(request, getFeedSchema('product'));
  return buildSampleRequest(request, summary!, ids, col);
};
const ours = (doc: Record<string, unknown>, slug: string) => ({ ...doc, base_url: `${PUB}/v1/acme`, request: { ...(doc.request as object), path: `/${slug}` } });

// ── Jivox's Sample A: GET, comma-separated ids, Bearer ──
const reqA = { method: 'GET', query: { ids: '{item_id}', locale: '{_meta.openai/locale}', market: 'US' }, maxIdsPerCall: 100 } as never;
const inputA: ContractInput = {
  feedType: 'product', apiSlug: 'live-prices', brandSlug: 'acme', publicBaseUrl: PUB, authHeader: 'bearer',
  design: { idField: { responseKey: 'id' }, fields: [field('current_price', 'price', 'float')], request: reqA } as never,
  request: reqA, agent: { fields: ['current_price'], info: null },
  sample: { query: sampleOf(reqA, ['SKU-1001', 'SKU-2049']).query as Record<string, unknown> },
  answer: { status: 200, body: sampleA.response }, sampleIds: ['SKU-1001', 'SKU-2049'],
};
const a = buildContract(inputA);
eq("Sample A (GET + Bearer): our document = Jivox's, key for key (only base_url + path are ours)", a.document, ours(sampleA, 'live-prices'));
eq('  sample_request drops the chat context, keeps the literal', a.document.sample_request, { ids: 'SKU-1001,SKU-2049', market: 'US' });

// ── Jivox's Sample B: POST, one object per row with an input column, X-Api-Key ──
const reqB = { method: 'POST', body: sampleB.request.body, maxIdsPerCall: 50 } as never;
const b = buildContract({
  ...inputA, apiSlug: 'pricing-batch', authHeader: 'x_api_key',
  design: { idField: { responseKey: 'sku' }, fields: [field('current_price', 'amount', 'float'), field('custom_badge_2_value', 'list_price', 'string', { default: 'n/a' })], request: reqB } as never,
  request: reqB, agent: { fields: ['current_price', 'custom_badge_2_value'], info: null },
  sample: { body: sampleOf(reqB, ['SKU-1001', 'SKU-3311'], (id) => (id === 'SKU-1001' ? 'shoes' : 'apparel')).body },
  answer: { status: 200, body: sampleB.response }, sampleIds: ['SKU-1001', 'SKU-3311'],
});
eq("Sample B (POST + X-Api-Key, {category} input, context, literals, default n/a, max 50): = Jivox's", b.document, ours(sampleB, 'pricing-batch'));
eq('  the context object disappears from sample_request (Jivox drops it entirely)', 'context' in (b.document.sample_request as object), false);
eq('  no token anywhere in either document', [JSON.stringify(a.document), JSON.stringify(b.document)].some((t) => /rtk_|Bearer [^{]/.test(t)), false);

// ── The user's example: feed header "sub" → response key "subkey" → Jivox sub_title ──
const reqU = { method: 'GET', query: { ids: '{item_id}' }, maxIdsPerCall: 100 } as never;
const designU = { idField: { responseKey: 'id' }, fields: [
  field('current_price', 'amount', 'float', { sourceColumn: 'price' }),
  field('sub_title', 'subkey', 'string', { sourceColumn: 'sub' }),
  field('currency', 'currency', 'string', { sourceColumn: 'cur' }),
  field('brand_name', 'brand', 'string'),
], request: reqU } as never;
const answerU = { status: 200, body: { status: 'success', generated_at: '2026-10-12T10:00:00Z', data: [{ id: '7', amount: 34.99, subkey: 'Pure Craft. Perfect Finish.', currency: 'USD', brand: 'V' }, { id: '8', amount: 29.5, subkey: 'Sunlit Citrus', currency: 'USD', brand: 'V' }, { id: '9', amount: 1, subkey: 'x', currency: 'USD', brand: 'V' }], errors: [] } };
const forAgent = (fields: string[], info: ContractInput['agent']['info'] = null, extra: Partial<ContractInput> = {}) =>
  buildContract({ ...inputA, authHeader: 'x_api_key', design: designU, request: reqU, agent: { fields, info }, sample: { query: { ids: '7,8' } }, answer: answerU, sampleIds: ['7', '8'], ...extra });
const u = forAgent(['sub_title']);
eq('agent bound to sub_title → fields: item_id at $.data[*].id, sub_title at $.data[*].subkey', u.document.fields, [
  { column_name: 'item_id', at: '$.data[*].id', type: 'string', default_value: '' },
  { column_name: 'sub_title', at: '$.data[*].subkey', type: 'string', default_value: '' },
]);
eq('  the response shows our real items (2 at most, whole: extra keys are ignored by Jivox)', [(u.document.response.data as unknown[]).length, Object.keys((u.document.response.data as object[])[0])], [2, ['id', 'amount', 'subkey', 'currency', 'brand']]);
eq('  X-Api-Key style; path = our API; base = PUBLIC_BASE_URL/v1/<brand>', [u.document.service_header, u.document.service_value_format, u.document.request.path, u.document.base_url], ['X-Api-Key', '{token}', '/live-prices', `${PUB}/v1/acme`]);
const g = forAgent(['sub_title', 'currency', 'current_price']);
eq('another agent on the SAME API (group currency + current_price + sub_title) → its own fields, design order, same URL', [(g.document.fields as { column_name: string }[]).map((f) => f.column_name), g.document.base_url + g.document.request.path], [['item_id', 'current_price', 'sub_title', 'currency'], u.document.base_url + u.document.request.path]);
eq('  current_price → $.data[*].amount, float', (g.document.fields as { column_name: string }[]).find((f) => f.column_name === 'current_price'), { column_name: 'current_price', at: '$.data[*].amount', type: 'float', default_value: '' });

// ── Notes ──
const codes = (r: { notes: { code: string; level: string }[] }) => r.notes.map((n) => `${n.level}:${n.code}`);
eq('fields picked by hand (no Read from Jivox) → info note only', codes(u), ['info:FIELDS_NOT_FROM_JIVOX']);
const part = forAgent(['current_price', 'description']);
eq('a bound field the design lacks (group decision A) → left out + a warning; the rest stays', [(part.document.fields as { column_name: string }[]).map((f) => f.column_name), codes(part)], [['item_id', 'current_price'], ['info:FIELDS_NOT_FROM_JIVOX', 'warning:FIELD_NOT_IN_DESIGN']]);
eq('  the warning names the field and the Design tab', part.notes[1].message.includes('"description"') && part.notes[1].message.includes('Design tab'), true);
eq('no fields at all → blocker NO_FIELDS (contract = the id only)', [codes(forAgent([])), (forAgent([]).document.fields as unknown[]).length], [['info:FIELDS_NOT_FROM_JIVOX', 'blocker:NO_FIELDS'], 1]);
eq('fields none of which the design serves → blocker NO_FIELDS', codes(forAgent(['description'])).at(-1), 'blocker:NO_FIELDS');
const info = (over: Record<string, unknown> = {}) => ({ feedType: 'product', idColumn: 'item_id', boundFields: ['sub_title'], credential: 'service', serviceTokenRegistered: true, schema: getFeedSchema('product').fields.map((f) => ({ name: f.name, type: f.typeHint, tier: f.tier, isId: f.name === 'item_id', group: null })), contracts: { activeVersion: null, versions: [] }, ...over }) as never;
eq('read from Jivox, everything fine → no notes', codes(forAgent(['sub_title'], info())), []);
eq('Jivox says another feed type → blocker FEED_TYPE_DIFFERS', codes(forAgent(['sub_title'], info({ feedType: 'review' }))), ['blocker:FEED_TYPE_DIFFERS']);
const liveTypes = info({ schema: [{ name: 'sub_title', type: 'image', tier: 'optional', isId: false, group: null }] });
eq("Jivox's LIVE type wins in the contract; differing design type → warning TYPE_DIFFERS", [(forAgent(['sub_title'], liveTypes).document.fields as { type: string }[])[1].type, codes(forAgent(['sub_title'], liveTypes))], ['image', ['warning:TYPE_DIFFERS']]);
const notInContract = buildContract({ ...inputA, design: { ...(inputA.design as object), fields: [field('current_price', 'price', 'float', { typeInContract: false })] } as never });
eq('a field kept out of the contract\'s types (R5) → no "type" key (Jivox fills it)', 'type' in (notInContract.document.fields as object[])[1], false);
eq('our answer fails (e.g. 400) → blocker SAMPLE_FAILED', codes(forAgent(['sub_title'], info(), { answer: { status: 400, body: { status: 'failure', errors: [] } } })), ['blocker:SAMPLE_FAILED']);
eq('sample id not in the data → warning SAMPLE_IDS_UNKNOWN naming it', [codes(forAgent(['sub_title'], info(), { answer: { status: 200, body: { status: 'success', generated_at: 'x', data: [], errors: [{ error_id: 'NOPE', error_code: 'NOT_FOUND', error_message: 'unknown id' }] } } })), forAgent(['sub_title'], info(), { answer: { status: 200, body: { status: 'success', data: [], errors: [{ error_id: 'NOPE', error_code: 'NOT_FOUND' }] } } }).notes[0]?.message.includes('NOPE')], [['warning:SAMPLE_IDS_UNKNOWN'], true]);
eq('call_rules: max from the design, the rest dictated', u.document.call_rules, { max_ids_per_call: 100, timeout_ms: 3000, retries: 0, response_must_be_no_store: true });
eq('key order like the template', Object.keys(u.document), ['contract_format', 'feed_type', 'base_url', 'credential', 'service_header', 'service_value_format', 'request', 'response', 'fields', 'call_rules', 'sample_request']);
eq('file names', [contractFileName('price-api', 'axas · Real Time Agent 1'), contractFileName('p', '***'), contractFileName('p', 'Ünïcode Agent')], ['contract-price-api-axas-real-time-agent-1.json', 'contract-p-agent.json', 'contract-p-unicode-agent.json']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
