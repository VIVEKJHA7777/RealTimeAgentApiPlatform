// Turns a stored text value into the JSON value our API sends for a field type (P3-4).
// The data is stored exactly as written (R8); conversion happens only when answering.
// A value that can't be converted is treated as MISSING (the field's default applies), so we
// never send Jivox a wrong type.
//
// ONE set of rules for two engines: these pattern strings are used here (JavaScript, when
// answering and for defaults) AND in SQL (value-checks.ts: counting over 500 000 rows in
// Postgres). Both regex engines read them the same way: only [0-9], explicit ASCII spaces
// (\t \n ...), no \d \s \w (their meaning differs between JS and Postgres for non-ASCII text).
import type { FieldType } from '../../jivox/feed-schemas.js';

export const PATTERNS = {
  // "12", "-3", "4.0" (whole number written with .0); max 15 digits = always exact in JS
  int: '^[+-]?[0-9]{1,15}([.]0+)?$',
  // "79.99", ".5", "1e3"; not "1,234" or "12 €"; limits keep the number finite (no 1e999)
  float: '^[+-]?([0-9]{1,30}[.]?[0-9]{0,30}|[.][0-9]{1,30})([eE][+-]?[0-9]{1,2})?$',
  // absolute http(s) URL with a host, no spaces: "https://cdn.example.com/a.png" (any case)
  image: '^https?://[^ \\t\\n\\r\\f\\v/?#]+([/?#][^ \\t\\n\\r\\f\\v]*)?$',
  // YYYY-MM-DD, or that date plus a time we drop (YYYY-MM-DDTHH:mm:ss[.fraction][Z|±HH:MM]
  // or YYYY-MM-DD HH:mm:ss[.fraction]). The calendar-day check is separate (Feb 31 matches this).
  date: '^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([ T]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})?)?$',
} as const;

// Compared in lower case. "1"/"0" are also numbers: detection treats such columns as int first.
export const TRUE_WORDS = ['true', 'yes', '1'];
export const FALSE_WORDS = ['false', 'no', '0'];
export const BOOLEAN_WORDS = [...TRUE_WORDS, ...FALSE_WORDS];

const INT = new RegExp(PATTERNS.int);
const FLOAT = new RegExp(PATTERNS.float);
const IMAGE = new RegExp(PATTERNS.image, 'i');
const DATE = new RegExp(PATTERNS.date);

export type Converted = { ok: true; value: string | number | boolean | string[] } | { ok: false };

// List items from one cell. `|` wins when the cell has one (commas stay inside an item);
// otherwise `,` splits. Pieces are trimmed; empty pieces are dropped.
export function listItems(text: string): string[] {
  const value = text.trim();
  const sep = value.includes('|') ? '|' : ',';
  return value.split(sep).map((part) => part.trim()).filter((part) => part.length > 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

// A real calendar date as YYYY-MM-DD, or null. A time on the end is accepted and dropped.
export function parseDate(text: string): string | null {
  const match = DATE.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (day > daysInMonth(year, month)) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

// `text` is never empty here: callers treat "" / whitespace as missing before converting.
// Stored cells are already trimmed (import); defaults typed by users are trimmed here.
export function convertValue(type: FieldType, text: string): Converted {
  const value = text.trim();
  switch (type) {
    case 'string':
      return { ok: true, value: text }; // as written
    case 'int':
      return INT.test(value) ? { ok: true, value: Number(value) } : { ok: false };
    case 'float':
      return FLOAT.test(value) ? { ok: true, value: Number(value) } : { ok: false };
    case 'boolean': {
      const word = value.toLowerCase();
      if (TRUE_WORDS.includes(word)) return { ok: true, value: true };
      if (FALSE_WORDS.includes(word)) return { ok: true, value: false };
      return { ok: false };
    }
    case 'image':
      return IMAGE.test(value) ? { ok: true, value } : { ok: false };
    case 'array': {
      const items = listItems(value);
      return items.length > 0 ? { ok: true, value: items } : { ok: false };
    }
    case 'date': {
      const date = parseDate(value);
      return date ? { ok: true, value: date } : { ok: false };
    }
  }
}
