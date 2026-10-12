// What the browser may send for an API's Jivox agents (Phase 5, task 5.2). Zod = one place for the rules.
import { z } from 'zod';

export const AGENT_NAME_MAX = 60;
export const MAX_AGENTS_PER_API = 20;
export const MAX_SAMPLE_IDS = 10;

const name = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(AGENT_NAME_MAX, `Name can be at most ${AGENT_NAME_MAX} characters`);

// A label only (e.g. "axas-c63e9"); "" or null = none.
const brandstore = z
  .string()
  .trim()
  .max(100, 'Brandstore can be at most 100 characters')
  .nullable()
  .transform((v) => (v ? v : null));

// Jivox column names (snake_case). Duplicates are dropped, order kept.
const fields = z
  .array(z.string().trim().regex(/^[a-z][a-z0-9_]{0,99}$/, 'Each field is a Jivox column name like "sub_title"'), 'fields must be a list')
  .max(100, 'At most 100 fields')
  .transform((list) => [...new Set(list)]);

// The agent's MCP destination from Studio. https only; http just for localhost (development / tests).
// No user:password@ part (the access key is sent separately, never in a URL).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const mcpUrl = z
  .string()
  .trim()
  .max(500, 'The MCP URL can be at most 500 characters')
  .refine((v) => {
    try {
      const u = new URL(v);
      if (u.username || u.password) return false;
      return u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname));
    } catch {
      return false;
    }
  }, 'Use the https:// MCP destination shown in Studio')
  .nullable()
  .transform((v) => (v ? v : null));

// The agent's MCP access key from Studio. Write-only: sent to set or replace it, null to remove it.
const accessKey = z
  .string()
  .trim()
  .min(8, 'That access key looks too short: copy it again from Studio')
  .max(500, 'That access key is too long')
  .regex(/^\S+$/, 'An access key has no spaces')
  .nullable();

const tokenId = z.string().min(1).max(100).nullable();

// Real ids of the data to verify with; empty = the first 2 rows. Duplicates dropped.
const sampleIds = z
  .array(z.string().trim().min(1, 'A sample id is empty').max(500, 'A sample id can be at most 500 characters'), 'sampleIds must be a list')
  .max(MAX_SAMPLE_IDS, `At most ${MAX_SAMPLE_IDS} sample ids`)
  .transform((list) => [...new Set(list)]);

// POST /agents
export const createAgentSchema = z.object({
  name,
  brandstore: brandstore.default(null),
  fields: fields.default([]),
  tokenId: tokenId.default(null),
  mcpUrl: mcpUrl.default(null),
  accessKey: accessKey.default(null),
  sampleIds: sampleIds.default([]),
});

// PATCH /agents/:agentId: only what is sent changes. accessKey: a new one replaces it, null removes it.
export const updateAgentSchema = z
  .object({
    name: name.optional(),
    brandstore: brandstore.optional(),
    fields: fields.optional(),
    tokenId: tokenId.optional(),
    mcpUrl: mcpUrl.optional(),
    accessKey: accessKey.optional(),
    sampleIds: sampleIds.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one thing to change');

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

// POST /agents/:agentId/contract/taken (5.6): the contract the user just copied or downloaded,
// exactly as shown, so the agent can say "out of date" when today's contract differs from it.
// Only its shape is kept (the sample answer / request are dropped), at most 64 KB.
export const contractTakenSchema = z.object({
  how: z.enum(['copy', 'download'], 'how must be copy or download'),
  designVersion: z.int('designVersion must be a whole number').min(0),
  document: z
    .object({
      contract_format: z.literal('contract/1', 'Not a contract/1 document'),
      base_url: z.string().max(2000),
      request: z.object({ method: z.enum(['GET', 'POST']), path: z.string().max(500) }).loose(),
      fields: z.array(z.object({ column_name: z.string().max(100), at: z.string().max(200) }).loose()).min(1).max(201),
    })
    .loose(),
});
export type ContractTakenInput = z.infer<typeof contractTakenSchema>;

// ── Phase 6 (task 6.4): writing to Jivox ──
// POST …/jivox/submit: `anyway` = send even with ✗ in the checklist (P6-3, for testing Jivox's own checks).
export const submitSchema = z.object({ anyway: z.boolean('anyway must be true or false').default(false) }).strict();
// :version in …/jivox/versions/:version/activate
export const versionParam = z.coerce.number().int('Version must be a whole number').min(1, 'Version must be 1 or more').max(1_000_000);
// GET …/jivox/actions?before=<id>&limit=20
export const historyQuery = z.object({
  before: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
