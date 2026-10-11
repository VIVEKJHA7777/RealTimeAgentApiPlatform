// SERVICE for an API's design (Phase 3): what the API sends. No req/res here.
//
// Saved as JSON on the API (apis.design) + a version number (apis.design_version) that goes up
// by 1 on every save. A save sends the version it loaded; if someone saved in between, it's
// refused (409 DESIGN_CHANGED) instead of silently overwriting their work.
import type { Api, FeedType } from '../../../generated/prisma/client.js';
import { AppError } from '../../../lib/app-error.js';
import { prisma } from '../../../lib/prisma.js';
import { getFeedSchema } from '../../jivox/feed-schemas.js';
import { checkDesign, suggestResponseKey } from './design-rules.js';
import { checkRequest, defaultRequest } from './request-rules.js';
import type { SaveDesignInput, StoredDesign } from './design.schemas.js';
import { shapeContextOf } from '../agents/contract.js';
import { changedContracts, droppedAgentFields, type ImpactAgent, unconfirmed } from '../agents/design-impact.js';

// The API's Jivox agents and the fields they use (5.6): the Design tab marks those fields, and a
// save that takes one away asks first.
const agentsOf = (tx: Pick<typeof prisma, 'jivoxAgent'>, apiId: string) =>
  tx.jivoxAgent.findMany({
    where: { apiId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, fields: true, agentInfo: true },
  });
const agentUse = (agents: ImpactAgent[]) => agents.map((a) => ({ id: a.id, name: a.name, fields: a.fields }));

type DesignState = {
  feedType: FeedType;
  status: string;
  design: StoredDesign | null;
  designVersion: number;
  idColumn: string;
  columns: string[];
};

// What the Design tab gets: the design (or a starting one) checked against the CURRENT data
// and feed type, so changes made since the save (other data, another feed type) show up as
// problems instead of failing later at Jivox.
function describe(state: DesignState) {
  const feedSchema = getFeedSchema(state.feedType);
  const design: StoredDesign = state.design ?? {
    idField: { responseKey: suggestResponseKey(state.idColumn) },
    fields: [],
  };
  const { problems, warnings } = checkDesign(design, {
    feedSchema,
    columns: state.columns,
    idColumn: state.idColumn,
  });
  // Saved before 3.4 (or never): the starting request, GET ?ids={id}.
  const request = design.request ?? defaultRequest(feedSchema);
  const checkedRequest = checkRequest(request, feedSchema);
  problems.push(...checkedRequest.problems);
  return {
    design: {
      version: state.designVersion, // send this back when saving
      saved: state.design !== null, // false = a starting point, nothing saved yet
      idField: {
        jivoxColumn: feedSchema.idColumn, // fixed per feed type (R2)
        sourceColumn: state.idColumn, // fixed: the data's id column
        responseKey: design.idField.responseKey,
      },
      // Postgres JSONB keeps keys in its own order: answer in a fixed, readable one.
      fields: design.fields.map((f) => ({
        jivoxColumn: f.jivoxColumn,
        sourceColumn: f.sourceColumn,
        responseKey: f.responseKey,
        type: f.type,
        typeInContract: f.typeInContract,
        default: f.default,
        onMismatch: f.onMismatch ?? 'send', // saved before the option existed: the default
        onEmpty: f.onEmpty ?? 'empty_string', // same
      })),
      request: {
        method: request.method,
        ...(request.query !== undefined && { query: request.query }),
        ...(request.body !== undefined && { body: request.body }),
        maxIdsPerCall: request.maxIdsPerCall,
      },
    },
    // Where the ids (and per-row / context values) sit in a valid request: what the /v1
    // endpoint (Phase 4) reads and the contract (Phase 5) describes. null while it has problems.
    requestSummary: checkedRequest.summary,
    // For the "From your column" dropdown (R3), in file order.
    data: { idColumn: state.idColumn, columns: state.columns },
    feedType: state.feedType,
    problems,
    warnings,
  };
}

// GET /apis/:apiSlug/design
export async function getDesign(api: Api) {
  const fresh = await prisma.api.findUnique({
    where: { id: api.id },
    select: {
      feedType: true,
      status: true,
      design: true,
      designVersion: true,
      dataSource: { select: { idColumn: true, columns: true } },
    },
  });
  if (!fresh) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
  const agents = await agentsOf(prisma, api.id);
  const result = describe({
    feedType: fresh.feedType,
    status: fresh.status,
    design: fresh.design as StoredDesign | null,
    designVersion: fresh.designVersion,
    idColumn: fresh.dataSource.idColumn,
    columns: fresh.dataSource.columns as string[],
  });
  return { ...result, agents: agentUse(agents) };
}

type LockedApi = {
  slug: string;
  auth_header: 'x_api_key' | 'bearer';
  design_version: number;
  design: StoredDesign | null;
  data_source_id: string;
  feed_type: FeedType;
  status: string;
};
type LockedDataSource = { id_column: string; columns: string[] };

// PUT /apis/:apiSlug/design
export async function saveDesign(api: Api, brandSlug: string, input: SaveDesignInput) {
  const state = await prisma.$transaction(async (tx) => {
    // Lock order (always API, then data source) so two transactions can't wait on each other:
    // 1. The API row (FOR UPDATE): a second save, or a PATCH switching its data / feed type,
    //    waits until we're done, so we check against exactly what we save on.
    const [locked] = await tx.$queryRaw<LockedApi[]>`
      SELECT slug, auth_header::text AS auth_header, design_version, design, data_source_id,
             feed_type::text AS feed_type, status::text AS status
      FROM apis WHERE id = ${api.id} AND organization_id = ${api.organizationId} FOR UPDATE`;
    if (!locked) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
    if (locked.design_version !== input.version) {
      throw new AppError(
        409,
        'DESIGN_CHANGED',
        'Someone saved this design after you opened it. Reload to see the latest version.',
        {
          details: [
            {
              field: 'version',
              message: `The latest version is ${locked.design_version}`,
            },
          ],
        },
      );
    }

    // 2. The data source row (FOR SHARE): a new version of the data can't switch in (its
    //    columns may change) until this save is done. Reads and other saves aren't blocked.
    const [dataSource] = await tx.$queryRaw<LockedDataSource[]>`
      SELECT id_column, columns FROM data_sources WHERE id = ${locked.data_source_id} FOR SHARE`;

    // No request sent → keep the saved one (or start with GET ?ids={id}).
    const feedSchema = getFeedSchema(locked.feed_type);
    const design: StoredDesign = {
      idField: input.idField,
      fields: input.fields,
      request: input.request ?? locked.design?.request ?? defaultRequest(feedSchema),
    };
    const { problems } = checkDesign(design, {
      feedSchema,
      columns: dataSource.columns,
      idColumn: dataSource.id_column,
    });
    problems.push(...checkRequest(design.request!, feedSchema).problems);
    if (problems.length > 0) {
      throw new AppError(400, 'DESIGN_INVALID', 'The design has problems', {
        details: problems,
      });
    }

    // 3. Jivox agents (5.6, P5-6): the save never blocks, but taking a field away from an agent
    //    is confirmed first. Read under the API lock, so an agent added or edited a moment ago
    //    (same lock) is in the list, and the confirmation must cover it too.
    const agents = await agentsOf(tx, api.id);
    const dropped = droppedAgentFields(locked.design, design, agents);
    if (unconfirmed(dropped, input.confirmDroppedFields).length > 0) {
      const n = dropped.length;
      throw new AppError(
        409,
        'AGENT_FIELDS_DROPPED',
        `This change takes fields away from ${n} Jivox ${n === 1 ? 'agent' : 'agents'}. Confirm to save anyway.`,
        { extra: { agents: dropped } },
      );
    }

    const saved = await tx.api.update({
      where: { id: api.id },
      data: { design, designVersion: { increment: 1 } },
      select: { designVersion: true },
    });
    const shape = (d: StoredDesign | null, version: number) =>
      shapeContextOf({ slug: locked.slug, feedType: locked.feed_type, authHeader: locked.auth_header, design: d, designVersion: version }, brandSlug);
    return {
      agents,
      dropped,
      changed: changedContracts(shape(locked.design, locked.design_version), shape(design, saved.designVersion), agents),
      feedType: locked.feed_type,
      status: locked.status,
      design,
      designVersion: saved.designVersion,
      idColumn: dataSource.id_column,
      columns: dataSource.columns,
    };
  });

  const result = {
    ...describe(state),
    agents: agentUse(state.agents),
    // 5.6: what this save did to the agents' contracts (the Design tab says "copy them again").
    agentImpact: { dropped: state.dropped, changed: state.changed },
  };
  if (state.changed.length > 0) {
    const names = state.changed.map((a) => a.name);
    result.warnings.push(
      `This save changed the contract of ${names.length === 1 ? '1 Jivox agent' : `${names.length} Jivox agents`} (${names.join(', ')}). Copy the new one from the Jivox tab.`,
    );
  }
  // P3-13: a published API changes at once; Jivox's active contract may no longer match.
  if (state.status === 'published') {
    result.warnings.unshift(
      'This API is published: the new design applies now. Generate and activate a new contract in Jivox.',
    );
  }
  return result;
}
