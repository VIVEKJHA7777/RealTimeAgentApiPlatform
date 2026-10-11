// The data guard (task 3.6): data an API answers from must keep every column its saved design
// sends. Used in three places:
//   1. uploading a new version (replace): checked on the file's header → 409 at once
//   2. the import's switch: checked again INSIDE the switch transaction (a design may have been
//      saved while the file was importing) → the import fails, the old data stays
//   3. switching an API to other data (PATCH dataSourceId) → 409
// Column names are compared exactly (a renamed "Price" is a missing "price").
// A merge import never removes columns (old + new), so only a replace can trip it.
import type { Prisma } from '../../../generated/prisma/client.js';
import { prisma } from '../../../lib/prisma.js';
import type { StoredDesign } from './design.schemas.js';

type Db = Prisma.TransactionClient | typeof prisma;

// The columns a design reads (in design order, each once). The id is not listed: its column is
// the data's id column, which every version of the data must have anyway.
export function columnsOfDesign(design: StoredDesign | null): string[] {
  return [...new Set((design?.fields ?? []).map((f) => f.sourceColumn))];
}

export function missingColumns(design: StoredDesign | null, columns: string[]): string[] {
  const available = new Set(columns);
  return columnsOfDesign(design).filter((column) => !available.has(column));
}

export type ApiMissingColumns = { name: string; slug: string; missing: string[] };

// Every API on this data source whose design needs a column `columns` doesn't have.
// Inside a transaction, pass `tx`: it then sees designs committed before this statement.
export async function apisMissingColumns(
  db: Db,
  dataSourceId: string,
  columns: string[],
): Promise<ApiMissingColumns[]> {
  const apis = await db.api.findMany({
    where: { dataSourceId },
    select: { name: true, slug: true, design: true },
    orderBy: { name: 'asc' },
  });
  return apis
    .map((api) => ({
      name: api.name,
      slug: api.slug,
      missing: missingColumns(api.design as StoredDesign | null, columns),
    }))
    .filter((api) => api.missing.length > 0);
}

// "API "Live prices" (live-prices) sends price, name"
export function describeMissing(api: ApiMissingColumns) {
  const list = api.missing.map((c) => `"${c}"`).join(', ');
  return `API "${api.name}" (${api.slug}) sends ${list}, which the new data doesn't have`;
}
