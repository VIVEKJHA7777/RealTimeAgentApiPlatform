// Publish / unpublish (Phase 4, task 4.4). Only a PUBLISHED API answers on /v1 (P4-5).
//
// Publishing needs (each missing one is a "reason", all listed at once):
//   NO_DESIGN        a response design was saved
//   DESIGN_INVALID   it still passes every design + request rule against the API's CURRENT data
//                    and feed type (the same checks as a save)
//   NO_DATA          the data has a finished version with at least one row
//   NO_ACTIVE_TOKEN  at least one token that isn't revoked or expired
// Afterwards the API stays published even if every token expires (P4-18: calls get
// TOKEN_EXPIRED; one Extend fixes it).
//
// Two people at once: publish and unpublish lock the API row, then the data source row, the
// same order as design saves and data switches. Token changes lock the API row too, so a
// "revoke the last token" can't slip between the check and the publish.
import type { Prisma } from '../../generated/prisma/client.js';
import type { Api } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { getFeedSchema } from '../jivox/feed-schemas.js';
import { toPublicApi, withDataSourceSummary } from './apis.service.js';
import { checkDesign } from './design/design-rules.js';
import type { StoredDesign } from './design/design.schemas.js';
import { checkRequest, defaultRequest } from './design/request-rules.js';

type Tx = Prisma.TransactionClient;
export type PublishReason = { code: 'NO_DESIGN' | 'DESIGN_INVALID' | 'NO_DATA' | 'NO_ACTIVE_TOKEN'; message: string };

// Everything that stops this API from being published right now ([] = it can be).
async function reasonsFor(db: Tx | typeof prisma, apiId: string): Promise<PublishReason[] | null> {
  const api = await db.api.findUnique({
    where: { id: apiId },
    select: {
      feedType: true,
      design: true,
      designVersion: true,
      dataSource: { select: { columns: true, idColumn: true, activeGeneration: true, rowCount: true } },
    },
  });
  if (!api) return null;
  const reasons: PublishReason[] = [];
  const ds = api.dataSource;

  const design = api.design as StoredDesign | null;
  if (!design || api.designVersion === 0) {
    reasons.push({ code: 'NO_DESIGN', message: 'Design the response first (Design tab) and save it.' });
  } else {
    const feedSchema = getFeedSchema(api.feedType);
    const problems = [
      ...checkDesign(design, { feedSchema, columns: ds.columns as string[], idColumn: ds.idColumn }).problems,
      ...checkRequest(design.request ?? defaultRequest(feedSchema), feedSchema).problems,
    ];
    if (problems.length > 0) {
      const first = problems[0];
      reasons.push({
        code: 'DESIGN_INVALID',
        message:
          `The saved design has ${problems.length} problem${problems.length === 1 ? '' : 's'} ` +
          `(first: ${first.field}: ${first.message}). Fix ${problems.length === 1 ? 'it' : 'them'} on the Design tab.`,
      });
    }
  }

  if (ds.activeGeneration === null) {
    reasons.push({ code: 'NO_DATA', message: 'The data is still being imported (or the import failed). Wait for it, or upload again.' });
  } else if (ds.rowCount === 0) {
    reasons.push({ code: 'NO_DATA', message: 'The data has no rows. Upload a file with rows.' });
  }

  const activeTokens = await db.apiToken.count({
    where: { apiId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });
  if (activeTokens === 0) {
    const any = await db.apiToken.count({ where: { apiId, revokedAt: null } });
    reasons.push({
      code: 'NO_ACTIVE_TOKEN',
      message: any > 0
        ? 'Every token of this API has expired. Extend or renew one (Test tab).'
        : 'Create a token first (Test tab): Jivox needs one to call the API.',
    });
  }
  return reasons;
}

// GET /publish-check: for the Publish button (enabled, or the reasons why not).
export async function publishCheck(api: Api) {
  const reasons = await reasonsFor(prisma, api.id);
  if (!reasons) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
  const fresh = await prisma.api.findUnique({ where: { id: api.id }, select: { status: true, publishedAt: true } });
  return { status: fresh?.status ?? api.status, publishedAt: fresh?.publishedAt ?? null, canPublish: reasons.length === 0, reasons };
}

async function lockApiAndData(tx: Tx, apiId: string) {
  const [locked] = await tx.$queryRaw<{ data_source_id: string }[]>`
    SELECT data_source_id FROM apis WHERE id = ${apiId} FOR UPDATE`;
  if (!locked) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
  await tx.$queryRaw`SELECT 1 FROM data_sources WHERE id = ${locked.data_source_id} FOR SHARE`;
}

// POST /publish. Already published → same answer (publishedAt unchanged). Blocked → 409 with
// every reason in details ({ field: <code>, message }).
export async function publishApi(api: Api, brandSlug: string) {
  const updated = await prisma.$transaction(async (tx) => {
    await lockApiAndData(tx, api.id);
    const current = await tx.api.findUniqueOrThrow({ where: { id: api.id }, include: withDataSourceSummary });
    if (current.status === 'published') return current;
    const reasons = (await reasonsFor(tx, api.id)) ?? [];
    if (reasons.length > 0) {
      throw new AppError(409, 'PUBLISH_BLOCKED', "This API can't be published yet", {
        details: reasons.map((r) => ({ field: r.code, message: r.message })),
      });
    }
    return tx.api.update({
      where: { id: api.id },
      data: { status: 'published', publishedAt: new Date() },
      include: withDataSourceSummary,
    });
  });
  return { api: toPublicApi(updated, brandSlug) };
}

// POST /unpublish. /v1 answers 404 from the next call on. Already a draft → same answer.
// publishedAt is kept (= when it was last published).
export async function unpublishApi(api: Api, brandSlug: string) {
  const updated = await prisma.$transaction(async (tx) => {
    await lockApiAndData(tx, api.id);
    return tx.api.update({ where: { id: api.id }, data: { status: 'draft' }, include: withDataSourceSummary });
  });
  return { api: toPublicApi(updated, brandSlug) };
}
