// The contract generator (Phase 5, task 5.3): one contract/1 document per Jivox agent.
//
// The mapping is the API's design (Phase 3): Jivox field → our feed column → response key. For an
// agent, the contract lists the id first, then ONLY the agent's fields, each pointing at the key our
// answer uses:   { "column_name": "sub_title", "at": "$.data[*].subkey", "type": "string", "default_value": "" }
// Everything else comes from the API: base URL + path, the header carrying the token, the request
// template (copied as saved: placeholders, literals, chat context), the call rules, and a real
// sample (2 real ids, the request Jivox sends at verification, and our real answer to it).
//
// Rules from Jivox's server (task 5.0, P5-11 / P5-15 / P5-17):
//   - fields: at least one of the agent's bound fields, at most all; a bound field the design
//     doesn't serve is LEFT OUT (Jivox keeps the feed's value) with a note
//   - type: Jivox's type for that field (its live schema when read, else ours: all 43 matched);
//     "not in contract" fields (R5) omit it (Jivox fills it from its schema)
//   - no token ever appears in the document
// buildContract is pure (no database, no network): docs/test-scripts/phase-05-task-5.3-contract-lib.test.ts.
import type { Api, JivoxAgent } from '../../../generated/prisma/client.js';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/app-error.js';
import { prisma } from '../../../lib/prisma.js';
import { getFeedSchema } from '../../jivox/feed-schemas.js';
import type { RequestTemplate, StoredDesign } from '../design/design.schemas.js';
import { defaultRequest } from '../design/request-rules.js';
import { answerInApp, defaultIds, describeRequest, loadContext, sampleFor } from '../testing/testing.service.js';
import type { JivoxAgentInfo } from './agents.service.js';
import { type ContractShape, contractShape, sameShape, shapeChanges } from './contract-shape.js';

export const CONTRACT_FORMAT = 'contract/1';
export const CALL_RULES = { timeout_ms: 3000, retries: 0, response_must_be_no_store: true } as const; // dictated
const SAMPLE_ITEMS = 2; // items shown in the contract's "response" (like Jivox's samples)

export type ContractNote = {
  level: 'blocker' | 'warning' | 'info';
  code: 'NO_FIELDS' | 'FIELD_NOT_IN_DESIGN' | 'TYPE_DIFFERS' | 'FEED_TYPE_DIFFERS' | 'FIELDS_NOT_FROM_JIVOX' | 'SAMPLE_FAILED' | 'SAMPLE_IDS_UNKNOWN';
  field?: string;
  message: string;
};

export type ContractInput = {
  feedType: string;
  apiSlug: string;
  brandSlug: string;
  publicBaseUrl: string;
  authHeader: 'x_api_key' | 'bearer';
  design: StoredDesign;
  request: RequestTemplate; // the design's request (or the default one)
  agent: { fields: string[]; info: JivoxAgentInfo | null };
  sample: { query?: Record<string, unknown>; body?: unknown }; // what Jivox sends at verification
  answer: { status: number; body: unknown }; // our real answer to it
  sampleIds: string[];
};

const HEADERS = {
  x_api_key: { service_header: 'X-Api-Key', service_value_format: '{token}' },
  bearer: { service_header: 'Authorization', service_value_format: 'Bearer {token}' },
} as const;

export function buildContract(input: ContractInput) {
  const notes: ContractNote[] = [];
  const schema = getFeedSchema(input.feedType as never);
  const idColumn = input.agent.info?.idColumn ?? schema.idColumn;
  const jivoxType = (name: string) =>
    input.agent.info?.schema.find((f) => f.name === name)?.type ?? schema.fields.find((f) => f.name === name)?.typeHint ?? 'string';

  if (input.agent.info && input.agent.info.feedType !== input.feedType) {
    notes.push({
      level: 'blocker',
      code: 'FEED_TYPE_DIFFERS',
      message: `Jivox says this agent serves the ${input.agent.info.feedType} feed, but this API serves ${input.feedType}.`,
    });
  }
  if (!input.agent.info) {
    notes.push({ level: 'info', code: 'FIELDS_NOT_FROM_JIVOX', message: 'Fields picked by hand: save the agent\'s access key and "Read from Jivox" to use the fields bound in Studio.' });
  }

  // The agent's fields, in the DESIGN's order (the order the API answers in), each mapped to its key.
  const wanted = new Set(input.agent.fields);
  const mapped = input.design.fields.filter((f) => wanted.has(f.jivoxColumn));
  for (const name of input.agent.fields) {
    if (!mapped.some((f) => f.jivoxColumn === name)) {
      notes.push({
        level: 'warning',
        code: 'FIELD_NOT_IN_DESIGN',
        field: name,
        message: `"${name}" isn't in this API's design, so it's left out of the contract (Jivox keeps the feed's value). Add it on the Design tab to answer it live.`,
      });
    }
  }
  for (const f of mapped) {
    const type = jivoxType(f.jivoxColumn);
    if (f.type !== type) {
      notes.push({
        level: 'warning',
        code: 'TYPE_DIFFERS',
        field: f.jivoxColumn,
        message: `Jivox expects "${f.jivoxColumn}" as ${type}; the design sends it as ${f.type}. The contract says ${type}: set ${type} on the Design tab.`,
      });
    }
  }
  if (mapped.length === 0) {
    notes.push({
      level: 'blocker',
      code: 'NO_FIELDS',
      message: input.agent.fields.length === 0
        ? 'This agent has no fields yet. "Read from Jivox" (or pick them) first.'
        : "None of this agent's fields are in the API's design. Jivox needs at least one: add them on the Design tab.",
    });
  }

  const idKey = input.design.idField.responseKey;
  const fields = [
    { column_name: idColumn, at: `$.data[*].${idKey}`, type: 'string', default_value: '' },
    ...mapped.map((f) => ({
      column_name: f.jivoxColumn,
      at: `$.data[*].${f.responseKey}`,
      ...(f.typeInContract !== false && { type: jivoxType(f.jivoxColumn) }),
      default_value: f.default ?? '',
    })),
  ];

  const isGet = input.request.method === 'GET';
  const document = {
    contract_format: CONTRACT_FORMAT,
    feed_type: input.feedType,
    base_url: `${input.publicBaseUrl}/v1/${input.brandSlug}`,
    credential: 'service',
    ...HEADERS[input.authHeader],
    request: {
      method: input.request.method,
      path: `/${input.apiSlug}`,
      ...(isGet ? { query: input.request.query ?? {} } : { body: input.request.body }),
    },
    response: sampleResponse(input.answer.body),
    fields,
    call_rules: { max_ids_per_call: input.request.maxIdsPerCall, ...CALL_RULES },
    sample_request: isGet ? (input.sample.query ?? {}) : input.sample.body,
  };

  if (input.answer.status < 200 || input.answer.status >= 300) {
    notes.push({ level: 'blocker', code: 'SAMPLE_FAILED', message: `Our API answers the sample request with HTTP ${input.answer.status}, so Jivox's verification would fail.` });
  } else {
    const unknown = errorsOf(input.answer.body).filter((e) => e.error_code === 'NOT_FOUND').map((e) => e.error_id);
    if (unknown.length > 0) {
      notes.push({ level: 'warning', code: 'SAMPLE_IDS_UNKNOWN', message: `Sample ids not in the data: ${unknown.join(', ')}. Jivox's verification needs ids it gets an answer for.` });
    }
  }
  return { document, notes };
}

type Envelope = { status?: unknown; generated_at?: unknown; data?: unknown; errors?: unknown };
const errorsOf = (body: unknown) => (Array.isArray((body as Envelope)?.errors) ? ((body as Envelope).errors as { error_id: string; error_code: string }[]) : []);

// Our real answer for the document: at most 2 items, as we sent them (Jivox's samples show the whole
// item, extra keys included: they're ignored).
function sampleResponse(body: unknown) {
  const env = (body ?? {}) as Envelope;
  return {
    status: env.status ?? 'success',
    generated_at: env.generated_at ?? new Date().toISOString(),
    data: Array.isArray(env.data) ? env.data.slice(0, SAMPLE_ITEMS) : [],
    errors: errorsOf(body).slice(0, SAMPLE_ITEMS),
  };
}

// ── Loading it all for one agent ──
// Everything the generator and the checklist (5.4) need, loaded once.
export async function prepareAgentContract(api: Api, brandSlug: string, agentId: string) {
  const agent = await prisma.jivoxAgent.findFirst({ where: { id: agentId, apiId: api.id }, include: { token: true } });
  if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent not found');
  const ctx = await loadContext(api, brandSlug); // 409 NO_DESIGN / NO_DATA / DESIGN_INVALID
  const sampleIds = agent.sampleIds.length > 0 ? agent.sampleIds : await defaultIds(ctx);
  const sample = await sampleFor(ctx, sampleIds);
  const answer = await answerInApp(ctx, sample);
  const info = agent.agentInfo as JivoxAgentInfo | null;
  const { document, notes } = buildContract({
    feedType: ctx.feedType,
    apiSlug: ctx.slug,
    brandSlug,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    authHeader: ctx.authHeader,
    design: ctx.runtime.design,
    request: ctx.request,
    agent: { fields: agent.fields, info },
    sample: { query: sample.query, body: sample.body },
    answer,
    sampleIds,
  });
  return { agent, info, ctx, sampleIds, sample, answer, document, notes, contract: contractState(agent, contractShape(document)) };
}

export async function generateAgentContract(api: Api, brandSlug: string, agentId: string) {
  const p = await prepareAgentContract(api, brandSlug, agentId);
  return {
    agent: { id: p.agent.id, name: p.agent.name },
    document: p.document,
    notes: p.notes,
    sample: { ids: p.sampleIds, request: describeRequest(p.sample), response: { status: p.answer.status, body: p.answer.body } },
    apiStatus: p.ctx.status,
    designVersion: p.ctx.designVersion,
    contract: p.contract,
  };
}

// ── Out of date (task 5.6) ──
// Today's SHAPE of an agent's contract needs no data at all (only the API, its design and the
// agent), so the agents list can say "out of date" for 20 agents without one data query.
export type ShapeContext = Omit<ContractInput, 'agent' | 'sample' | 'answer' | 'sampleIds'>;

export function shapeContextOf(
  api: { slug: string; feedType: string; authHeader: 'x_api_key' | 'bearer'; design: StoredDesign | null; designVersion: number },
  brandSlug: string,
): ShapeContext | null {
  if (!api.design || api.designVersion === 0) return null; // no contract can be made yet
  return {
    feedType: api.feedType,
    apiSlug: api.slug,
    brandSlug,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    authHeader: api.authHeader,
    design: api.design,
    request: api.design.request ?? defaultRequest(getFeedSchema(api.feedType as never)),
  };
}

export async function loadShapeContext(api: Api, brandSlug: string) {
  const fresh = await prisma.api.findUnique({
    where: { id: api.id },
    select: { slug: true, feedType: true, authHeader: true, design: true, designVersion: true },
  });
  return fresh ? shapeContextOf({ ...fresh, design: fresh.design as StoredDesign | null }, brandSlug) : null;
}

export function shapeFor(ctx: ShapeContext, agent: { fields: string[]; agentInfo: unknown }): ContractShape {
  const { document } = buildContract({
    ...ctx,
    agent: { fields: agent.fields, info: agent.agentInfo as JivoxAgentInfo | null },
    sample: {},
    answer: { status: 200, body: {} },
    sampleIds: [],
  });
  return contractShape(document);
}

type LastContractRow = Pick<JivoxAgent, 'lastContractAt' | 'lastContractHow' | 'lastContractDesignVersion' | 'lastContractShape'>;

// What the screen shows: the contract last taken out, and whether today's differs from it.
//   last: null            → never copied / downloaded (nothing to be out of date with)
//   outOfDate: null       → unknown (no design to compare with)
export function contractState(row: LastContractRow, current: ContractShape | null) {
  const last = row.lastContractAt && row.lastContractShape
    ? { at: row.lastContractAt, how: row.lastContractHow, designVersion: row.lastContractDesignVersion }
    : null;
  if (!last || !current) return { last, outOfDate: null, changes: [] as string[] };
  const before = row.lastContractShape as ContractShape;
  const outOfDate = !sameShape(before, current);
  return { last, outOfDate, changes: outOfDate ? shapeChanges(before, current) : [] };
}
export type ContractState = ReturnType<typeof contractState>;

// "contract-price-api-axas-real-time-agent-1.json"
export function contractFileName(apiSlug: string, agentName: string) {
  const agent = agentName.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'agent';
  return `contract-${apiSlug}-${agent}.json`;
}
