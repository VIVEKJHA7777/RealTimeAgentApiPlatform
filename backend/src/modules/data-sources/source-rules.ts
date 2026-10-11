// Shared rules for data from ANY source (CSV now, JSON / Google Sheets later).
// Connectors only deliver "header + rows of raw text"; these rules are the same for every source.
// Values are stored as text exactly as written: no type guessing (types are chosen per API later).
import { AppError } from '../../lib/app-error.js';

export type Problem = { row: number | null; message: string };

// We report at most this many problems: a broken 500 000-row file shouldn't produce 500 000 messages.
export const MAX_PROBLEMS = 5;

// Spaces around a value are removed; an empty cell becomes null (= "no value").
export function normalizeCell(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  return value === '' ? null : value;
}

// Rows like ",,," (every cell empty) are skipped, like empty lines.
export function isEmptyRow(values: (string | null)[]): boolean {
  return values.every((value) => value === null);
}

// Header rules: every column has a name, names are unique (ignoring upper/lower case), not too many.
// Throws 400 SOURCE_INVALID listing the problems. Returns the trimmed column names.
export function checkHeader(rawHeader: string[], maxColumns: number): string[] {
  const names = rawHeader.map((name) => name.trim());
  const problems: string[] = [];

  names.forEach((name, index) => {
    if (!name) problems.push(`Column ${index + 1} has no name`);
  });

  const firstIndexOf = new Map<string, number>();
  names.forEach((name, index) => {
    if (!name) return;
    const key = name.toLowerCase();
    const first = firstIndexOf.get(key);
    if (first === undefined) firstIndexOf.set(key, index);
    else problems.push(`Column "${name}" appears twice (columns ${first + 1} and ${index + 1})`);
  });

  if (names.length > maxColumns) {
    problems.push(`The file has ${names.length} columns; the limit is ${maxColumns}`);
  }

  if (problems.length > 0) {
    throw new AppError(400, 'SOURCE_INVALID', 'The header row (row 1) has problems', {
      details: problems.slice(0, MAX_PROBLEMS).map((message) => ({ field: 'row 1', message })),
    });
  }
  return names;
}

// A row must have exactly one value per column.
export function rowWidthProblem(rowNumber: number, valueCount: number, columnCount: number) {
  if (valueCount === columnCount) return null;
  return {
    row: rowNumber,
    message: `Row ${rowNumber} has ${valueCount} ${valueCount === 1 ? 'value' : 'values'}, but the header has ${columnCount} columns`,
  };
}

// Helps the user pick the id column: which columns have a value in every row seen and no
// value twice? (Preview only, on the first rows; the import checks every row.)
export class IdCandidateFinder {
  private rows = 0;
  private present: number[];
  private seen: Set<string>[];
  private duplicated: boolean[];

  constructor(private readonly columns: string[]) {
    this.present = columns.map(() => 0);
    this.seen = columns.map(() => new Set<string>());
    this.duplicated = columns.map(() => false);
  }

  add(values: (string | null)[]) {
    this.rows++;
    values.forEach((value, i) => {
      if (value === null) return;
      this.present[i]++;
      if (this.duplicated[i]) return;
      if (this.seen[i].has(value)) this.duplicated[i] = true;
      else this.seen[i].add(value);
    });
  }

  // Best first: names that look like ids ("id", "sku", "item_id", "*_id") before others.
  candidates(): string[] {
    return this.columns
      .filter((_, i) => this.rows > 0 && this.present[i] === this.rows && !this.duplicated[i])
      .sort((a, b) => idNameScore(b) - idNameScore(a));
  }
}

function idNameScore(name: string): number {
  const n = name.toLowerCase();
  if (['id', 'sku', 'item_id', 'product_id', 'itemid', 'productid'].includes(n)) return 3;
  if (n.endsWith('_id') || n.endsWith('id')) return 2;
  if (n.includes('sku') || n.includes('code')) return 1;
  return 0;
}
