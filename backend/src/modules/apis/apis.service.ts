// SERVICE layer for APIs: business rules + database. No req/res here.
//
// An API = a named endpoint of a brand that answers from ONE of the brand's data sources.
// Several APIs may share a data source (each will send different fields, Phase 3).
// Deleting an API never deletes its data.
import type { Api, Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { isForeignKeyViolation, isNotFound, isUniqueViolation } from '../../lib/prisma-errors.js';
import { findOwnedDataSource } from '../data-sources/data-sources.service.js';
import type { CreateApiInput, UpdateApiInput } from './apis.schemas.js';
import { missingColumns } from './design/column-guard.js';
import type { StoredDesign } from './design/design.schemas.js';
import { headerStyle } from './tokens/tokens.service.js';

// Every answer shows a short summary of the API's data (for the cards and the API page).
export const withDataSourceSummary = {
  dataSource: {
    select: { id: true, name: true, idColumn: true, rowCount: true, activeGeneration: true },
  },
} satisfies Prisma.ApiInclude;

type ApiWithDataSource = Prisma.ApiGetPayload<{ include: typeof withDataSourceSummary }>;

// What the browser may see of an API.
export function toPublicApi(api: ApiWithDataSource, brandSlug: string) {
  const { dataSource } = api;
  return {
    id: api.id,
    name: api.name,
    slug: api.slug,
    // Where Jivox will call it (Phase 4); shown in the UI with a copy button.
    path: `/v1/${brandSlug}/${api.slug}`,
    feedType: api.feedType,
    status: api.status, // draft until published (Phase 4)
    designVersion: api.designVersion, // 0 = no design saved yet (Phase 3)
    authHeader: headerStyle(api.authHeader), // how Jivox sends the token (Phase 4)
    publishedAt: api.publishedAt,
    dataSource: {
      id: dataSource.id,
      name: dataSource.name,
      idColumn: dataSource.idColumn,
      rowCount: dataSource.rowCount,
      hasData: dataSource.activeGeneration !== null,
    },
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

const slugTaken = (cause: unknown) =>
  new AppError(409, 'API_SLUG_TAKEN', 'This brand already has an API with this slug', {
    details: [{ field: 'slug', message: 'Choose another slug' }],
    cause,
  });

const dataSourceNotFound = (cause?: unknown) =>
  new AppError(404, 'DATA_SOURCE_NOT_FOUND', 'Data source not found', {
    details: [{ field: 'dataSourceId', message: 'Choose data of this brand' }],
    cause,
  });

// The data source must be THIS brand's. Checked here for a clear 404; the composite foreign
// key (data_source_id, organization_id) makes any other brand's data impossible anyway.
async function checkDataSource(organizationId: string, dataSourceId: string) {
  if (!(await findOwnedDataSource(organizationId, dataSourceId))) throw dataSourceNotFound();
}

// POST /apis
export async function createApi(organizationId: string, brandSlug: string, input: CreateApiInput) {
  await checkDataSource(organizationId, input.dataSourceId);
  try {
    const api = await prisma.api.create({
      data: { organizationId, ...input },
      include: withDataSourceSummary,
    });
    return toPublicApi(api, brandSlug);
  } catch (err) {
    // Two creates with the same slug at the same moment: the UNIQUE index lets one win.
    if (isUniqueViolation(err, 'apis_organization_id_slug_key')) throw slugTaken(err);
    // The data source was deleted between our check and the insert.
    if (isForeignKeyViolation(err)) throw dataSourceNotFound(err);
    throw err;
  }
}

// GET /apis: newest first (id breaks ties, so the order is stable).
export async function listApis(organizationId: string, brandSlug: string) {
  const apis = await prisma.api.findMany({
    where: { organizationId },
    include: withDataSourceSummary,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return apis.map((api) => toPublicApi(api, brandSlug));
}

// Used by requireApi: the API with this slug, ONLY in this brand (one query); else null.
export async function findOwnedApi(organizationId: string, slug: string) {
  return prisma.api.findFirst({ where: { organizationId, slug } });
}

// GET /apis/:apiSlug
export async function getApi(api: Api, brandSlug: string) {
  const fresh = await prisma.api.findUnique({
    where: { id: api.id },
    include: withDataSourceSummary,
  });
  if (!fresh) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
  return toPublicApi(fresh, brandSlug);
}

// PATCH /apis/:apiSlug: change any of name, slug, feedType, dataSourceId.
// Changes apply IMMEDIATELY (decided 2026-10-11). On a published API, a new URL or new data
// means Jivox's active contract no longer matches → the answer carries warnings.
export async function updateApi(api: Api, brandSlug: string, input: UpdateApiInput) {
  const changesData = input.dataSourceId !== undefined && input.dataSourceId !== api.dataSourceId;
  if (changesData) await checkDataSource(api.organizationId, input.dataSourceId!);
  const changesFeedType = input.feedType !== undefined && input.feedType !== api.feedType;

  let updated: ApiWithDataSource;
  try {
    updated = await prisma.$transaction(async (tx) => {
      if (changesData) {
        // Data guard (3.6): the new data must have every column the design sends.
        // Lock order as in design saves (API row, then data source row), so a save or an
        // import switch running now can't slip a change in between the check and the update.
        const [locked] = await tx.$queryRaw<{ design: StoredDesign | null }[]>`
          SELECT design FROM apis WHERE id = ${api.id} FOR UPDATE`;
        const [target] = await tx.$queryRaw<{ columns: string[] }[]>`
          SELECT columns FROM data_sources
          WHERE id = ${input.dataSourceId} AND organization_id = ${api.organizationId} FOR SHARE`;
        // (Missing rows: the update below answers 404 through P2025 / P2003.)
        const missing = locked && target ? missingColumns(locked.design, target.columns) : [];
        if (missing.length > 0) {
          throw new AppError(
            409,
            'DATA_MISSING_COLUMNS',
            "The chosen data doesn't have every column this API sends. Choose other data, or change the design first.",
            {
              details: [
                {
                  field: 'dataSourceId',
                  message: `Missing: ${missing.map((c) => `"${c}"`).join(', ')}`,
                },
              ],
            },
          );
        }
      }
      // ONE statement: "update it, if it's still a draft" (when the feed type changes).
      // If it was published a moment ago, nothing is updated → P2025 → 409 below.
      return tx.api.update({
        where: {
          id: api.id,
          organizationId: api.organizationId,
          ...(changesFeedType && { status: 'draft' }),
        },
        data: input,
        include: withDataSourceSummary,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'apis_organization_id_slug_key')) throw slugTaken(err);
    if (isForeignKeyViolation(err)) throw dataSourceNotFound(err);
    if (isNotFound(err)) {
      // Nothing matched: deleted meanwhile, or (feed type change) no longer a draft.
      const current = await prisma.api.findUnique({ where: { id: api.id } });
      if (current && changesFeedType) {
        throw new AppError(
          409,
          'API_PUBLISHED',
          "The feed type of a published API can't change. Unpublish it first.",
          { cause: err },
        );
      }
      throw new AppError(404, 'API_NOT_FOUND', 'API not found', { cause: err });
    }
    throw err;
  }

  const warnings: string[] = [];
  if (updated.status === 'published') {
    if (updated.slug !== api.slug) {
      warnings.push(
        `The URL changed to /v1/${brandSlug}/${updated.slug}; the old one stopped working. ` +
          'Generate and activate a new contract in Jivox.',
      );
    }
    if (updated.dataSourceId !== api.dataSourceId) {
      warnings.push(
        'This API now answers from other data. Check the design, then generate and activate a new contract.',
      );
    }
  }
  return { api: toPublicApi(updated, brandSlug), warnings };
}

// DELETE /apis/:apiSlug: the API only; its data source (and the rows) stay.
export async function deleteApi(api: Api) {
  const { count } = await prisma.api.deleteMany({
    where: { id: api.id, organizationId: api.organizationId },
  });
  if (count === 0) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
}
