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
} as const;

// Compared in lower case. "1"/"0" are also numbers: detection treats such columns as int first.
export const TRUE_WORDS = ['true', 'yes', '1'];
export const FALSE_WORDS = ['false', 'no', '0'];
export const BOOLEAN_WORDS = [...TRUE_WORDS, ...FALSE_WORDS];

const INT = new RegExp(PATTERNS.int);
const FLOAT = new RegExp(PATTERNS.float);
const IMAGE = new RegExp(PATTERNS.image, 'i');

export type Converted = { ok: true; value: string | number | boolean } | { ok: false };

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
  }
}
