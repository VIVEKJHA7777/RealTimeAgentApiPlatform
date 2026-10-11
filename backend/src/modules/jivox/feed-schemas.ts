// The Jivox feed schemas: the canonical column names a contract's `fields[].column_name` may use,
// per feed type (product · review · store · content). Source: the CSVs Jivox shares
// (column_name, tier, description, example_format), kept in backend/jivox-schemas/ and copied
// from docs/jivox/feed-schemas/. Loaded ONCE when the server starts; a missing or broken file
// stops the start (better than designing APIs against a half-known schema).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import type { FeedType } from '../../generated/prisma/client.js';

export type FieldType = 'string' | 'int' | 'float' | 'boolean' | 'image';
export type Tier = 'mandatory' | 'expected' | 'optional';

export type JivoxField = {
  name: string; // e.g. "current_price"
  tier: Tier;
  description: string;
  example: string;
  // The schema CSVs have no type column. This is our best guess from the name (shown as a hint
  // and used by auto-detection when a data column is empty). Jivox's real type wins in a
  // contract that leaves `type` out (R5).
  typeHint: FieldType;
};

export type FeedSchema = {
  feedType: FeedType;
  // The column every row is identified by: always the FIRST field of a contract (the id echo).
  idColumn: string;
  fields: JivoxField[];
};

// Which schema column identifies a row, per feed type. Review: review_id (user's decision,
// 2026-10-11; item_id there is the product the review belongs to).
const ID_COLUMNS: Record<FeedType, string> = {
  product: 'item_id',
  review: 'review_id',
  store: 'store_id',
  content: 'content_id',
};

const TIERS = new Set<string>(['mandatory', 'expected', 'optional']);

// Type guess from a Jivox column name (approved rules, docs/jivox/README.md).
export function typeHintFor(feedType: FeedType, name: string): FieldType {
  if (name.startsWith('is_')) return 'boolean';
  if (
    /(^|_)(image|logo)(_|$)|image_url$|logo_url$|^photo_\d+_url$|^gallery_image_\d+$|^primary_image$/.test(
      name,
    )
  ) {
    return 'image';
  }
  if (feedType === 'review' && name === 'rating_value') return 'int'; // "integer values from 1 to 5"
  if (/(^|_)count$|^helpful_votes_up$|_scale_max$/.test(name)) return 'int';
  if (
    /price$|percentage$|^rating_value$|_rating_value$|^latitude$|^longitude$|^secondary_rating_\d+_value$/.test(
      name,
    )
  ) {
    return 'float';
  }
  return 'string';
}

function loadSchema(feedType: FeedType): FeedSchema {
  const file = fileURLToPath(
    new URL(`../../../jivox-schemas/${feedType}-feed-schema.csv`, import.meta.url),
  );
  const rows = parse(readFileSync(file), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  const seen = new Set<string>();
  const fields = rows.map((row, index) => {
    const name = row.column_name;
    if (!name || !/^[a-z][a-z0-9_]*$/.test(name))
      throw new Error(`${file}: row ${index + 2}: bad column_name "${name}"`);
    if (seen.has(name)) throw new Error(`${file}: column "${name}" appears twice`);
    if (!TIERS.has(row.tier))
      throw new Error(`${file}: row ${index + 2}: unknown tier "${row.tier}"`);
    seen.add(name);
    return {
      name,
      tier: row.tier as Tier,
      description: row.description ?? '',
      example: row.example_format ?? '',
      typeHint: typeHintFor(feedType, name),
    };
  });
  const idColumn = ID_COLUMNS[feedType];
  if (!seen.has(idColumn)) throw new Error(`${file}: the id column "${idColumn}" is missing`);
  // Id first, then the schema's own order (alphabetical in the files Jivox exports).
  fields.sort((a, b) => (a.name === idColumn ? -1 : b.name === idColumn ? 1 : 0));
  return { feedType, idColumn, fields };
}

const FEED_TYPES: FeedType[] = ['product', 'review', 'store', 'content'];
const schemas = new Map<FeedType, FeedSchema>(
  FEED_TYPES.map((feedType) => [feedType, loadSchema(feedType)]),
);

export function getFeedSchema(feedType: FeedType): FeedSchema {
  return schemas.get(feedType)!;
}

export function listFeedSchemas(): FeedSchema[] {
  return FEED_TYPES.map((feedType) => schemas.get(feedType)!);
}
