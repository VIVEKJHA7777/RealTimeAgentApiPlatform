// What the data's values look like, for the Design tab (task 3.3):
//
//   detectColumnTypes  "which types fit each column?" from the FIRST 10 000 rows → pre-fills
//                      the type dropdown (R5)
//   checkFieldValues   "how many rows of the WHOLE data can't be sent as this type?" → the
//                      "3 rows aren't numbers: they'll use the default" notes (P3-4)
//
// Both count in Postgres (one pass, nothing loaded into Node), with the SAME patterns the API
// uses to convert values when answering (convert.ts), so the counts match what Jivox will get.
// Both read inside one REPEATABLE READ snapshot: an import switching versions halfway can't mix
// two versions of the data into one answer.
import { Prisma } from '../../../generated/prisma/client.js';
import type { Api } from '../../../generated/prisma/client.js';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/app-error.js';
import { prisma } from '../../../lib/prisma.js';
import type { FieldType } from '../../jivox/feed-schemas.js';
import { BOOLEAN_WORDS, PATTERNS } from './convert.js';
import type { CheckValuesInput } from './design.schemas.js';

export const DETECT_SAMPLE_ROWS = 10_000;
// A type is suggested when at least this share of a column's non-empty values fit it, so one
// typo ("abc" among 1 000 prices) doesn't turn a price column into text. The rows that don't
// fit are what checkFieldValues reports.
const FIT_SHARE = 0.95;
const EXAMPLE_ROWS = 50; // rows read for example values
const EXAMPLES_PER_COLUMN = 3;
const BAD_EXAMPLES = 5;

type Snapshot = {
  dataSourceId: string;
  generation: number | null; // null = no data yet
  idColumn: string;
  columns: string[];
};

type Tx = Prisma.TransactionClient;

// Runs `fn` on the API's CURRENT data (read fresh: the API may have switched data meanwhile).
function inSnapshot<T>(api: Api, fn: (tx: Tx, snap: Snapshot) => Promise<T>) {
  return prisma.$transaction(
    async (tx) => {
      const fresh = await tx.api.findUnique({
        where: { id: api.id },
        select: {
          dataSource: {
            select: {
              id: true,
              activeGeneration: true,
              idColumn: true,
              columns: true,
            },
          },
        },
      });
      if (!fresh) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
      const ds = fresh.dataSource;
      return fn(tx, {
        dataSourceId: ds.id,
        generation: ds.activeGeneration,
        idColumn: ds.idColumn,
        columns: ds.columns as string[],
      });
    },
    // A full check of 1 000 000 rows takes seconds; Prisma's default limit is 5 s.
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60_000,
    },
  );
}

// The SQL value of a column in a row: the id lives in external_id, the rest in `data` (JSONB,
// text or null; empty cells are stored as null).
function valueOf(column: string, snap: Snapshot) {
  return column === snap.idColumn ? Prisma.sql`external_id` : Prisma.sql`(data ->> ${column})`;
}

// How many list items a cell has. `|` wins when the cell contains one; otherwise `,`.
// Same split as listItems() in convert.ts (trim each piece, drop empties).
function listItemCount(v: Prisma.Sql) {
  return Prisma.sql`(SELECT count(*)::int FROM unnest(string_to_array((${v}), CASE WHEN strpos((${v}), '|') > 0 THEN '|' ELSE ',' END)) AS part WHERE btrim(part) <> '')`;
}

// A real YYYY-MM-DD (time on the end allowed, then ignored). Same calendar as parseDate().
function dateFitsSql(v: Prisma.Sql) {
  const y = Prisma.sql`substring((${v}) from 1 for 4)::int`;
  const m = Prisma.sql`substring((${v}) from 6 for 2)`;
  const d = Prisma.sql`substring((${v}) from 9 for 2)::int`;
  // CASE runs the day check only after the shape matches, so a text cell never hits ::int.
  return Prisma.sql`CASE WHEN (${v}) ~ ${PATTERNS.date} THEN (
    ${d} <= CASE ${m}
      WHEN '02' THEN CASE WHEN (${y} % 4 = 0 AND ${y} % 100 <> 0) OR (${y} % 400 = 0) THEN 29 ELSE 28 END
      WHEN '04' THEN 30 WHEN '06' THEN 30 WHEN '09' THEN 30 WHEN '11' THEN 30
      ELSE 31 END
  ) ELSE false END`;
}

// "This value can be sent as `type`", in SQL. Same rules as convertValue() in convert.ts.
function fitsSql(type: Exclude<FieldType, 'string'>, v: Prisma.Sql) {
  switch (type) {
    case 'int':
      return Prisma.sql`${v} ~ ${PATTERNS.int}`;
    case 'float':
      return Prisma.sql`${v} ~ ${PATTERNS.float}`;
    case 'image':
      return Prisma.sql`${v} ~* ${PATTERNS.image}`; // ~* = case-insensitive (HTTPS://)
    case 'boolean':
      return Prisma.sql`lower(${v}) IN (${Prisma.join(BOOLEAN_WORDS)})`;
    case 'array':
      return Prisma.sql`${listItemCount(v)} >= 1`;
    case 'date':
      return dateFitsSql(v);
  }
}

const rowsOf = (snap: Snapshot) =>
  Prisma.sql`records WHERE data_source_id = ${snap.dataSourceId} AND generation = ${snap.generation}`;

// ───────────────────────── type detection (first 10 000 rows) ─────────────────────────

type ColumnStats = {
  filled: number;
  int: number;
  float: number;
  boolean: number;
  boolWords: number;
  image: number;
  array: number; // values that split into 2+ items (| or ,). One item still converts.
  date: number;
};

// Types that fit (≥ 95% of the non-empty values), best first. Empty column → [] (the Design
// tab then uses the Jivox field's type hint). "string" is always included (everything fits).
// array / date are added after it, so a text or number column keeps the same first suggestion.
export function candidateTypes(s: ColumnStats): FieldType[] {
  if (s.filled === 0) return [];
  const fits = (count: number) => count >= s.filled * FIT_SHARE;
  const types: FieldType[] = [];
  // true/false/yes/no words → boolean first; a column of only 1 / 0 is more likely a number,
  // so boolean comes after the number types there (a Jivox is_* hint still picks it).
  const boolFirst = fits(s.boolean) && s.boolWords > 0;
  if (boolFirst) types.push('boolean');
  if (fits(s.int)) types.push('int');
  if (fits(s.float)) types.push('float');
  if (fits(s.image)) types.push('image');
  if (fits(s.boolean) && !boolFirst) types.push('boolean');
  types.push('string');
  if (fits(s.date)) types.push('date');
  if (fits(s.array)) types.push('array');
  return types;
}

// The type to pre-fill: the Jivox field's hint if the data allows it, else the best fit.
// (The Design tab uses the same rule; shared here for the preview and tests.)
export function suggestType(candidates: FieldType[], jivoxHint?: FieldType): FieldType {
  if (jivoxHint && (candidates.length === 0 || candidates.includes(jivoxHint))) return jivoxHint;
  return candidates[0] ?? 'string';
}

// GET /apis/:apiSlug/design/columns
export function detectColumnTypes(api: Api) {
  return inSnapshot(api, async (tx, snap) => {
    const empty = {
      filled: 0,
      int: 0,
      float: 0,
      boolean: 0,
      boolWords: 0,
      image: 0,
      array: 0,
      date: 0,
    };
    let sampled = 0;
    let stats: ColumnStats[] = snap.columns.map(() => ({ ...empty }));
    let examples: string[][] = snap.columns.map(() => []);

    if (snap.generation !== null && snap.columns.length > 0) {
      // One pass over the sample; per column i: c{i}_f (non-empty), c{i}_int, ... (counts).
      const values = snap.columns.map(
        (col, i) => Prisma.sql`${valueOf(col, snap)} AS v${Prisma.raw(String(i))}`,
      );
      const counts = snap.columns.map((_, i) => {
        const v = Prisma.raw(`v${i}`);
        const c = (name: string) => Prisma.raw(`c${i}_${name}`);
        return Prisma.sql`count(${v})::int AS ${c('f')},
          count(*) FILTER (WHERE ${fitsSql('int', v)})::int AS ${c('int')},
          count(*) FILTER (WHERE ${fitsSql('float', v)})::int AS ${c('float')},
          count(*) FILTER (WHERE ${fitsSql('boolean', v)})::int AS ${c('boolean')},
          count(*) FILTER (WHERE lower(${v}) IN (${Prisma.join(BOOLEAN_WORDS.filter((w) => !/^[01]$/.test(w)))}))::int AS ${c('words')},
          count(*) FILTER (WHERE ${fitsSql('image', v)})::int AS ${c('image')},
          count(*) FILTER (WHERE ${listItemCount(v)} >= 2)::int AS ${c('array')},
          count(*) FILTER (WHERE ${fitsSql('date', v)})::int AS ${c('date')}`;
      });
      const [row] = await tx.$queryRaw<Record<string, number>[]>`
        SELECT count(*)::int AS sampled, ${Prisma.join(counts)}
        FROM (SELECT ${Prisma.join(values)} FROM ${rowsOf(snap)}
              ORDER BY position LIMIT ${DETECT_SAMPLE_ROWS}) sample`;
      sampled = row.sampled;
      stats = snap.columns.map((_, i) => ({
        filled: row[`c${i}_f`],
        int: row[`c${i}_int`],
        float: row[`c${i}_float`],
        boolean: row[`c${i}_boolean`],
        boolWords: row[`c${i}_words`],
        image: row[`c${i}_image`],
        array: row[`c${i}_array`],
        date: row[`c${i}_date`],
      }));

      // Example values: the first distinct ones in file order (from the first 50 rows).
      const first = await tx.$queryRaw<
        { external_id: string; data: Record<string, string | null> }[]
      >`
        SELECT external_id, data FROM ${rowsOf(snap)} ORDER BY position LIMIT ${EXAMPLE_ROWS}`;
      examples = snap.columns.map((col) => {
        const seen: string[] = [];
        for (const r of first) {
          const value = col === snap.idColumn ? r.external_id : r.data[col];
          if (value != null && !seen.includes(shorten(value))) seen.push(shorten(value));
          if (seen.length === EXAMPLES_PER_COLUMN) break;
        }
        return seen;
      });
    }

    return {
      sampledRows: sampled, // ≤ 10 000
      columns: snap.columns.map((name, i) => {
        const s = stats[i];
        const candidates = candidateTypes(s);
        return {
          name,
          isId: name === snap.idColumn,
          filled: s.filled, // non-empty values in the sample
          empty: sampled - s.filled,
          // How many sampled values fit each type (string: all of them)
          fits: {
            int: s.int,
            float: s.float,
            boolean: s.boolean,
            image: s.image,
            array: s.array,
            date: s.date,
          },
          candidates, // best first; [] = no values to judge
          suggestedType: candidates[0] ?? null,
          examples: examples[i],
        };
      }),
    };
  });
}

const shorten = (value: string) => (value.length > 100 ? `${value.slice(0, 99)}…` : value);

// ───────────────────── value check (every row, per chosen field) ─────────────────────

let activeChecks = 0;

// POST /apis/:apiSlug/design/check-values   { fields: [{ sourceColumn, type }] }
export async function checkFieldValues(api: Api, input: CheckValuesInput) {
  // Each check reads every row (up to 1 000 000): only a few at a time, like downloads.
  if (activeChecks >= env.VALUE_CHECK_CONCURRENCY) {
    throw new AppError(
      429,
      'TOO_MANY_VALUE_CHECKS',
      'Too many value checks right now. Try again in a moment.',
    );
  }
  activeChecks++;
  try {
    return await inSnapshot(api, (tx, snap) => runCheck(tx, snap, input));
  } finally {
    activeChecks--;
  }
}

async function runCheck(tx: Tx, snap: Snapshot, input: CheckValuesInput) {
  const missing = input.fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !snap.columns.includes(f.sourceColumn))
    .map(({ f, i }) => ({
      field: `fields.${i}.sourceColumn`,
      message: `Your data has no column "${f.sourceColumn}"`,
    }));
  if (missing.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
      details: missing,
    });
  }

  // The same column + type asked twice is counted once.
  const pairs = [
    ...new Map(input.fields.map((f) => [`${f.sourceColumn}\u0000${f.type}`, f])).values(),
  ];
  const key = (f: { sourceColumn: string; type: FieldType }) => `${f.sourceColumn}\u0000${f.type}`;
  const results = new Map<
    string,
    {
      empty: number;
      cantConvert: number;
      examples: { row: number; id: string; value: string }[];
    }
  >();
  let rows = 0;

  if (snap.generation !== null && pairs.length > 0) {
    // One pass over EVERY row: per pair, non-empty count + "can't convert" count.
    const parts = pairs.map((f, i) => {
      const v = valueOf(f.sourceColumn, snap);
      const bad =
        f.type === 'string'
          ? Prisma.sql`0`
          : Prisma.sql`count(*) FILTER (WHERE ${v} IS NOT NULL AND NOT (${fitsSql(f.type, v)}))`;
      return Prisma.sql`count(${v})::int AS ${Prisma.raw(`p${i}_f`)}, (${bad})::int AS ${Prisma.raw(`p${i}_bad`)}`;
    });
    const [row] = await tx.$queryRaw<Record<string, number>[]>`
      SELECT count(*)::int AS rows, ${Prisma.join(parts)} FROM ${rowsOf(snap)}`;
    rows = row.rows;

    for (const [i, f] of pairs.entries()) {
      const cantConvert = row[`p${i}_bad`];
      let examples: { row: number; id: string; value: string }[] = [];
      if (cantConvert > 0 && f.type !== 'string') {
        // The first few, in file order (stops early through the position index).
        const v = valueOf(f.sourceColumn, snap);
        const bad = await tx.$queryRaw<{ position: number; external_id: string; value: string }[]>`
          SELECT position, external_id, ${v} AS value FROM ${rowsOf(snap)}
            AND ${v} IS NOT NULL AND NOT (${fitsSql(f.type, v)})
          ORDER BY position LIMIT ${BAD_EXAMPLES}`;
        examples = bad.map((b) => ({
          row: b.position,
          id: b.external_id,
          value: shorten(b.value),
        }));
      }
      results.set(key(f), {
        empty: rows - row[`p${i}_f`],
        cantConvert,
        examples,
      });
    }
  }

  return {
    rows, // rows in the live data
    fields: input.fields.map((f) => {
      const r = results.get(key(f)) ?? {
        empty: 0,
        cantConvert: 0,
        examples: [],
      };
      return {
        sourceColumn: f.sourceColumn,
        type: f.type,
        empty: r.empty, // no value → the default (or the key is left out)
        cantConvert: r.cantConvert, // has a value that isn't this type → same as empty
        examples: r.examples, // first ≤ 5 of those: { row (file order), id, value }
      };
    }),
  };
}
