// POST /apis/:apiSlug/design/preview (task 3.5): "what would Jivox send, and what would we
// answer?" for a design (the one being edited, saved or not) and a few real ids.
// Nothing is saved. Everything is read in ONE REPEATABLE READ snapshot, so the rows always
// come from one version of the data even if an import switches versions meanwhile.
import { Prisma } from '../../../generated/prisma/client.js';
import type { Api } from '../../../generated/prisma/client.js';
import { AppError } from '../../../lib/app-error.js';
import { prisma } from '../../../lib/prisma.js';
import { getFeedSchema } from '../../jivox/feed-schemas.js';
import {
  buildResponse,
  buildSampleRequest,
  queryString,
  type StoredRow,
} from './build-response.js';
import { checkDesign, suggestResponseKey } from './design-rules.js';
import type { PreviewInput, StoredDesign } from './design.schemas.js';
import { checkRequest, defaultRequest } from './request-rules.js';

export const PREVIEW_DEFAULT_IDS = 2; // like contract/1 Sample A

export function previewDesign(api: Api, brandSlug: string, input: PreviewInput) {
  return prisma.$transaction(
    async (tx) => {
      const fresh = await tx.api.findUnique({
        where: { id: api.id },
        select: {
          slug: true,
          feedType: true,
          design: true,
          dataSource: {
            select: { id: true, idColumn: true, columns: true, activeGeneration: true },
          },
        },
      });
      if (!fresh) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
      const ds = fresh.dataSource;
      const feedSchema = getFeedSchema(fresh.feedType);
      const saved = fresh.design as StoredDesign | null;

      // The design to preview: the one sent (being edited), else the saved / starting one.
      // A sent design without a request uses the saved request, like a save does.
      const design: StoredDesign = input.design
        ? { ...input.design, request: input.design.request ?? saved?.request }
        : (saved ?? { idField: { responseKey: suggestResponseKey(ds.idColumn) }, fields: [] });
      const request = design.request ?? defaultRequest(feedSchema);

      const checked = checkDesign(design, {
        feedSchema,
        columns: ds.columns as string[],
        idColumn: ds.idColumn,
      });
      const checkedRequest = checkRequest(request, feedSchema);
      const problems = [...checked.problems, ...checkedRequest.problems];
      if (problems.length > 0 || !checkedRequest.summary) {
        // Same answer as a save would give: fix these first.
        throw new AppError(400, 'DESIGN_INVALID', 'The design has problems', { details: problems });
      }
      const summary = checkedRequest.summary;

      if (ds.activeGeneration === null) {
        throw new AppError(409, 'NO_DATA', 'This API has no data yet. Upload a file first.');
      }
      if (input.ids && input.ids.length > request.maxIdsPerCall) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Too many ids', {
          details: [
            {
              field: 'ids',
              message: `At most ${request.maxIdsPerCall} ids per call (this design's maxIdsPerCall)`,
            },
          ],
        });
      }

      const where = Prisma.sql`data_source_id = ${ds.id} AND generation = ${ds.activeGeneration}`;
      // The ids: the ones asked for, else the first rows of the file.
      const ids =
        input.ids ??
        (
          await tx.$queryRaw<{ external_id: string }[]>`
            SELECT external_id FROM records WHERE ${where} ORDER BY position LIMIT ${PREVIEW_DEFAULT_IDS}`
        ).map((r) => r.external_id);
      const found = await tx.$queryRaw<
        { external_id: string; data: Record<string, string | null> }[]
      >`
        SELECT external_id, data FROM records WHERE ${where} AND external_id = ANY(${ids})`;
      const rowsById = new Map<string, StoredRow>(
        found.map((r) => [r.external_id, { externalId: r.external_id, data: r.data }]),
      );

      const { response, notes } = buildResponse(ids, rowsById, design, ds.idColumn);

      // POST {column} placeholders: Jivox fills them from ITS row. In the preview we use our
      // value for the field mapped to that Jivox column (if any), else "".
      const columnValue = (id: string, jivoxColumn: string) => {
        const field = design.fields.find((f) => f.jivoxColumn === jivoxColumn);
        const row = rowsById.get(id);
        if (!field || !row) return '';
        return (
          (field.sourceColumn === ds.idColumn ? row.externalId : row.data[field.sourceColumn]) ?? ''
        );
      };
      const sample = buildSampleRequest(request, summary, [...new Set(ids)], columnValue);
      const path = `/v1/${brandSlug}/${fresh.slug}`;

      const warnings = [...checked.warnings];
      // Values sent with the wrong type (onMismatch "send"): Jivox's verification checks types.
      const mistyped = [
        ...new Set(
          notes.filter((n) => n.used.startsWith('sent as written')).map((n) => n.responseKey),
        ),
      ];
      if (mistyped.length > 0) {
        warnings.push(
          `${mistyped.join(', ')}: some values aren't of the field's type and are sent as written. ` +
            "Jivox's verification call may reject them (fine for testing).",
        );
      }
      // Empty values sent as "" (onEmpty, the default) in a field that isn't text: also not its type.
      const emptyText = [
        ...new Set(
          notes
            .filter((n) => n.used.startsWith('sent as ""'))
            .filter((n) => design.fields.find((f) => f.responseKey === n.responseKey)?.type !== 'string')
            .map((n) => n.responseKey),
        ),
      ];
      if (emptyText.length > 0) {
        warnings.push(
          `${emptyText.join(', ')}: empty values are sent as "" (text). Jivox's verification call may ` +
            'reject that for a number / boolean / image field; set a Default or "leave the key out" if it does.',
        );
      }
      if (summary.context.length > 0) {
        warnings.push(
          'Chat context values are sent only when the chat host has them, and never in the ' +
            'verification call (so they are left out of this sample).',
        );
      }
      if (summary.method === 'GET') {
        // GET sends the ids as ONE comma-separated value: an id containing a comma would be
        // split in two. Checked over the whole data (one scan).
        const [{ count }] = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM records WHERE ${where} AND external_id LIKE '%,%'`;
        if (count > 0) {
          warnings.push(
            `${count} ${count === 1 ? 'id contains' : 'ids contain'} a comma: GET sends ids ` +
              'joined by commas, so those rows can never be asked for. Use POST, or ids without commas.',
          );
        }
      }

      return {
        request:
          sample.method === 'GET'
            ? {
                method: 'GET',
                path,
                query: sample.query,
                url: `${path}?${queryString(sample.query)}`,
              }
            : { method: 'POST', path, body: sample.body },
        response,
        responseHeaders: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
        // Values that didn't go out as written: which id, key, column, value, and what was sent.
        notes,
        warnings,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
