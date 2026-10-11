// SERVICE layer for an API's Jivox agents (Phase 5, task 5.2): business rules + database + the
// read-only "Read from Jivox".
//
// Rules (phase doc §5, P5-1/2/4/5/10/12/14):
//   - many agents per API (at most 20); name unique within the API (any case, spaces trimmed)
//   - fields: Jivox column names of the API's feed type; never the id column, never a mandatory field
//     (Jivox refuses both in a contract)
//   - token: one of THIS API's tokens, not revoked (the database also refuses another API's token)
//   - access key: write-only; stored encrypted and bound to the agent's row; only a 2-character hint is shown
//   - "Read from Jivox": the agent's MCP destination + key → feed type, id column, bound fields, live
//     tiers / types, its contracts. Jivox's bound fields then BECOME the agent's fields (when the
//     feed type matches). Only read-only MCP tools are called.
//
// Concurrency: every change locks the API row first (same lock as tokens and design saves), so
// limits, names and the token check see the latest state. "Read from Jivox" talks to Jivox WITHOUT
// the lock (up to 20 s per call), then locks and saves only if the agent's destination and key are
// still the ones it read with.
import { type Api, type ApiToken, type JivoxAgent, Prisma } from '../../../generated/prisma/client.js';
import { tokenState } from '../../../lib/api-token.js';
import { AppError } from '../../../lib/app-error.js';
import { createJivoxMcpClient, JivoxMcpError } from '../../../lib/jivox-mcp.js';
import { prisma } from '../../../lib/prisma.js';
import { isUniqueViolation } from '../../../lib/prisma-errors.js';
import { openSecret, sealSecret } from '../../../lib/secret-box.js';
import { getFeedSchema } from '../../jivox/feed-schemas.js';
import { type Tx, withApiLock } from '../tokens/tokens.service.js';
import { type ContractTakenInput, type CreateAgentInput, MAX_AGENTS_PER_API, type UpdateAgentInput } from './agents.schemas.js';
import { contractState, loadShapeContext, type ShapeContext, shapeFor } from './contract.js';
import { canonicalJson, contractShape } from './contract-shape.js';

type AgentRow = JivoxAgent & { token: ApiToken | null };

// What Jivox told us (stored in agent_info), in our own shape.
export type JivoxAgentInfo = {
  feedType: string;
  idColumn: string;
  boundFields: string[];
  credential: string | null;
  serviceTokenRegistered: boolean | null;
  // The feed schema as THIS brandstore sees it (tiers change with its UI components).
  schema: { name: string; type: string; tier: string; isId: boolean; group: string | null }[];
  contracts: { activeVersion: number | null; versions: unknown[] };
};

const bindKey = (agentId: string) => `jivox-agent:${agentId}`;
const keyHint = (key: string) => key.slice(-2);

// What the browser may see. Never the access key (only its hint), never the token itself.
// `shapes`: today's contract shape context (5.6 "out of date"); null = no design yet.
function toAgentInfo(row: AgentRow, shapes: ShapeContext | null, now = new Date()) {
  const info = row.agentInfo as JivoxAgentInfo | null;
  return {
    id: row.id,
    name: row.name,
    brandstore: row.brandstore,
    fields: row.fields,
    sampleIds: row.sampleIds,
    token: row.token ? { id: row.token.id, name: row.token.name, hint: row.token.hint, state: tokenState(row.token, now) } : null,
    mcpUrl: row.mcpUrl,
    accessKey: row.accessKeyEncrypted
      ? {
          hint: row.accessKeyHint,
          // false: saved with another TOKEN_ENCRYPTION_KEY (or changed in the DB): enter it again
          readable: openSecret(row.accessKeyEncrypted, bindKey(row.id)) !== null,
        }
      : null,
    jivox: info && row.agentInfoAt ? { ...info, readAt: row.agentInfoAt } : null,
    lastError: row.lastError,
    contract: contractState(row, shapes ? shapeFor(shapes, row) : null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export type AgentInfo = ReturnType<typeof toAgentInfo>;

const agentNotFound = () => new AppError(404, 'AGENT_NOT_FOUND', 'Agent not found');

async function findAgent(tx: Tx | typeof prisma, api: Api, agentId: string) {
  // Scoped by API: another API's (or brand's) agent id is simply "not found".
  const row = await tx.jivoxAgent.findFirst({ where: { id: agentId, apiId: api.id }, include: { token: true } });
  if (!row) throw agentNotFound();
  return row;
}

async function checkNameFree(tx: Tx, api: Api, name: string, exceptId?: string) {
  const rows = await tx.jivoxAgent.findMany({ where: { apiId: api.id, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { name: true } });
  if (rows.some((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase())) throw nameTaken(name);
}
const nameTaken = (name: string) =>
  new AppError(409, 'AGENT_NAME_TAKEN', `This API already has an agent named "${name}". Choose another name.`, {
    details: [{ field: 'name', message: 'Already used by another agent of this API' }],
  });

// Fields must be columns of the API's feed type, and never the id or a mandatory field.
function checkFields(api: Api, fields: string[]) {
  const schema = getFeedSchema(api.feedType);
  const byName = new Map(schema.fields.map((f) => [f.name, f]));
  const details = fields.flatMap((name, i) => {
    const f = byName.get(name);
    if (!f) return [{ field: `fields.${i}`, message: `"${name}" isn't a ${api.feedType} field in Jivox` }];
    if (name === schema.idColumn) return [{ field: `fields.${i}`, message: `"${name}" is the id: every contract sends it anyway` }];
    if (f.tier === 'mandatory') return [{ field: `fields.${i}`, message: `"${name}" is mandatory in Jivox: it comes from the feed, never from a Real Time Agent` }];
    return [];
  });
  if (details.length > 0) throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { details });
}

// A token of THIS API that isn't revoked (expired is fine: Extend can revive it).
async function checkToken(tx: Tx, api: Api, tokenId: string | null | undefined) {
  if (!tokenId) return;
  const token = await tx.apiToken.findFirst({ where: { id: tokenId, apiId: api.id } });
  if (!token) throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { details: [{ field: 'tokenId', message: 'Not a token of this API' }] });
  if (token.revokedAt) throw new AppError(409, 'TOKEN_REVOKED', `"${token.name}" was revoked. Pick an active token (or make a new one) for this agent.`);
}

// GET: the API's agents, oldest first.
export async function listAgents(api: Api, brandSlug: string) {
  const rows = await prisma.jivoxAgent.findMany({ where: { apiId: api.id }, orderBy: { createdAt: 'asc' }, include: { token: true } });
  const shapes = await loadShapeContext(api, brandSlug);
  const now = new Date();
  return { agents: rows.map((r) => toAgentInfo(r, shapes, now)), limits: { maxAgents: MAX_AGENTS_PER_API } };
}

// One agent as the browser sees it (after a change: compared with the design as it is now).
async function present(api: Api, brandSlug: string, row: AgentRow) {
  return toAgentInfo(row, await loadShapeContext(api, brandSlug));
}

// GET one
export async function getAgent(api: Api, brandSlug: string, agentId: string) {
  return { agent: await present(api, brandSlug, await findAgent(prisma, api, agentId)) };
}

// POST: a new agent. The access key (if sent) is encrypted bound to the new row's id.
export async function createAgent(api: Api, brandSlug: string, input: CreateAgentInput) {
  checkFields(api, input.fields);
  try {
    const row = await withApiLock(api, async (tx) => {
      await checkNameFree(tx, api, input.name);
      const count = await tx.jivoxAgent.count({ where: { apiId: api.id } });
      if (count >= MAX_AGENTS_PER_API) {
        throw new AppError(409, 'TOO_MANY_AGENTS', `An API can serve at most ${MAX_AGENTS_PER_API} agents. Remove one you don't use first.`);
      }
      await checkToken(tx, api, input.tokenId);
      const row = await tx.jivoxAgent.create({
        data: {
          apiId: api.id,
          name: input.name,
          brandstore: input.brandstore,
          fields: input.fields,
          tokenId: input.tokenId,
          mcpUrl: input.mcpUrl,
          sampleIds: input.sampleIds,
        },
      });
      const saved = input.accessKey
        ? await tx.jivoxAgent.update({
            where: { id: row.id },
            data: { accessKeyEncrypted: sealSecret(input.accessKey, bindKey(row.id)), accessKeyHint: keyHint(input.accessKey) },
            include: { token: true },
          })
        : await tx.jivoxAgent.findUniqueOrThrow({ where: { id: row.id }, include: { token: true } });
      return saved;
    });
    return { agent: await present(api, brandSlug, row) };
  } catch (err) {
    // The lock makes this rare; the unique index is the last word.
    if (isUniqueViolation(err)) throw nameTaken(input.name);
    throw err;
  }
}

// PATCH: only what is sent changes. A new MCP URL or access key clears what Jivox told us (it may
// describe another agent now).
export async function updateAgent(api: Api, brandSlug: string, agentId: string, input: UpdateAgentInput) {
  if (input.fields) checkFields(api, input.fields);
  try {
    const saved = await withApiLock(api, async (tx) => {
      const row = await findAgent(tx, api, agentId);
      if (input.name !== undefined) await checkNameFree(tx, api, input.name, row.id);
      if (input.tokenId !== undefined) await checkToken(tx, api, input.tokenId);
      const destinationChanged =
        (input.mcpUrl !== undefined && input.mcpUrl !== row.mcpUrl) || input.accessKey !== undefined;
      const data: Prisma.JivoxAgentUncheckedUpdateInput = {
        name: input.name,
        brandstore: input.brandstore,
        fields: input.fields,
        tokenId: input.tokenId,
        mcpUrl: input.mcpUrl,
        sampleIds: input.sampleIds,
        ...(input.accessKey !== undefined &&
          (input.accessKey === null
            ? { accessKeyEncrypted: null, accessKeyHint: null }
            : { accessKeyEncrypted: sealSecret(input.accessKey, bindKey(row.id)), accessKeyHint: keyHint(input.accessKey) })),
        ...(destinationChanged && { agentInfo: Prisma.DbNull, agentInfoAt: null, lastError: null }),
      };
      return tx.jivoxAgent.update({ where: { id: row.id }, data, include: { token: true } });
    });
    return { agent: await present(api, brandSlug, saved) };
  } catch (err) {
    if (isUniqueViolation(err) && input.name !== undefined) throw nameTaken(input.name);
    throw err;
  }
}

// DELETE: remove the agent (its key with it). Nothing changes in Jivox.
export async function deleteAgent(api: Api, agentId: string) {
  await withApiLock(api, async (tx) => {
    const row = await findAgent(tx, api, agentId);
    await tx.jivoxAgent.delete({ where: { id: row.id } });
  });
}

// POST …/contract/taken (5.6): remember the contract the user just copied / downloaded (its shape
// only), so the agent says "out of date" as soon as today's contract differs from it.
export const MAX_SHAPE_BYTES = 64 * 1024;
export async function markContractTaken(api: Api, brandSlug: string, agentId: string, input: ContractTakenInput) {
  const shape = contractShape(input.document);
  if (Buffer.byteLength(canonicalJson(shape)) > MAX_SHAPE_BYTES) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', { details: [{ field: 'document', message: 'The contract is too big (at most 64 KB without its samples)' }] });
  }
  const saved = await withApiLock(api, async (tx) => {
    const row = await findAgent(tx, api, agentId);
    return tx.jivoxAgent.update({
      where: { id: row.id },
      data: {
        lastContractAt: new Date(),
        lastContractHow: input.how,
        lastContractDesignVersion: input.designVersion,
        lastContractShape: shape as Prisma.InputJsonValue,
      },
      include: { token: true },
    });
  });
  return { agent: await present(api, brandSlug, saved) };
}

// ── Read from Jivox (read-only MCP tools) ──

type CanonicalSchema = {
  feed_type?: unknown;
  id_column?: unknown;
  bound_fields?: unknown;
  fields?: { field_name?: unknown; type?: unknown; tier?: unknown; is_id?: unknown; schema_key?: unknown }[];
};
type ContractSpec = { your_agent?: { credential?: unknown; service_token_registered?: unknown } };
type ContractList = { contracts?: unknown; active_version?: unknown };

const str = (v: unknown) => (typeof v === 'string' ? v : null);

function toJivoxInfo(schema: CanonicalSchema, spec: ContractSpec, list: ContractList): JivoxAgentInfo {
  const feedType = str(schema.feed_type);
  const idColumn = str(schema.id_column);
  const bound = Array.isArray(schema.bound_fields) ? schema.bound_fields.filter((f): f is string => typeof f === 'string') : null;
  if (!feedType || !idColumn || !bound || !Array.isArray(schema.fields)) {
    throw new JivoxMcpError('protocol', "Jivox's answer about the agent is missing its feed type, id column or fields.");
  }
  return {
    feedType,
    idColumn,
    boundFields: bound.slice(0, 100),
    credential: str(spec.your_agent?.credential),
    serviceTokenRegistered: typeof spec.your_agent?.service_token_registered === 'boolean' ? spec.your_agent.service_token_registered : null,
    schema: schema.fields.slice(0, 300).flatMap((f) => {
      const name = str(f.field_name);
      return name ? [{ name, type: str(f.type) ?? 'string', tier: str(f.tier) ?? 'optional', isId: f.is_id === true, group: str(f.schema_key) }] : [];
    }),
    contracts: {
      activeVersion: typeof list.active_version === 'number' ? list.active_version : null,
      versions: Array.isArray(list.contracts) ? list.contracts.slice(0, 50) : [],
    },
  };
}

function mcpFailure(err: JivoxMcpError) {
  if (err.kind === 'auth') return new AppError(422, 'JIVOX_AUTH_FAILED', err.message, { cause: err });
  if (err.kind === 'unreachable') return new AppError(502, 'JIVOX_UNREACHABLE', err.message, { cause: err });
  return new AppError(502, 'JIVOX_BAD_ANSWER', err.message, { cause: err });
}

// POST …/read-jivox → the agent with Jivox's facts; its fields become Jivox's bound fields when the
// feed types match. Failures are also remembered on the agent (lastError).
export async function readFromJivox(api: Api, brandSlug: string, agentId: string) {
  const row = await findAgent(prisma, api, agentId);
  if (!row.mcpUrl || !row.accessKeyEncrypted) {
    throw new AppError(409, 'AGENT_NOT_CONNECTED', 'Add the MCP destination and access key from Studio first (Real-time data → the agent → access keys).');
  }
  const key = openSecret(row.accessKeyEncrypted, bindKey(row.id));
  if (!key) throw new AppError(409, 'ACCESS_KEY_UNREADABLE', "The saved access key can't be read (it was saved with another encryption key). Paste it again.");
  const readWith = { mcpUrl: row.mcpUrl, accessKeyEncrypted: row.accessKeyEncrypted };

  let info: JivoxAgentInfo;
  try {
    const client = createJivoxMcpClient(row.mcpUrl, key);
    const schema = await client.callReadOnly<CanonicalSchema>('get_canonical_schema');
    const spec = await client.callReadOnly<ContractSpec>('get_contract_spec');
    const list = await client.callReadOnly<ContractList>('list_contracts');
    info = toJivoxInfo(schema, spec, list);
  } catch (err) {
    if (!(err instanceof JivoxMcpError)) throw err;
    await saveIfUnchanged(api, row.id, readWith, { lastError: err.message.slice(0, 1000) }).catch(() => undefined);
    throw mcpFailure(err);
  }

  const feedTypeMatches = info.feedType === api.feedType;
  const syncedFields = feedTypeMatches ? info.boundFields.filter(validField(api)) : null;
  const saved = await saveIfUnchanged(api, row.id, readWith, {
    agentInfo: info as unknown as Prisma.InputJsonValue,
    agentInfoAt: new Date(),
    ...(syncedFields && { fields: syncedFields }),
    lastError: feedTypeMatches
      ? null
      : `Jivox says this agent serves the ${info.feedType} feed, but this API serves ${api.feedType}. Use an API of the ${info.feedType} feed type for it.`,
  });
  return { agent: await present(api, brandSlug, saved), fieldsBefore: row.fields, feedTypeMatches };
}

// Bound fields we can keep: known, not the id, not mandatory (Jivox's own rules).
function validField(api: Api) {
  const schema = getFeedSchema(api.feedType);
  const byName = new Map(schema.fields.map((f) => [f.name, f]));
  return (name: string) => byName.has(name) && name !== schema.idColumn && byName.get(name)!.tier !== 'mandatory';
}

// Saves what we read only if the agent still points where we read from (no one changed its
// destination / key meanwhile, and it wasn't removed).
async function saveIfUnchanged(api: Api, agentId: string, readWith: { mcpUrl: string; accessKeyEncrypted: string }, data: Prisma.JivoxAgentUncheckedUpdateInput) {
  return withApiLock(api, async (tx) => {
    const now = await findAgent(tx, api, agentId);
    if (now.mcpUrl !== readWith.mcpUrl || now.accessKeyEncrypted !== readWith.accessKeyEncrypted) {
      throw new AppError(409, 'AGENT_CHANGED', "The agent's MCP destination or access key changed while reading. Read again.");
    }
    return tx.jivoxAgent.update({ where: { id: agentId }, data, include: { token: true } });
  });
}
