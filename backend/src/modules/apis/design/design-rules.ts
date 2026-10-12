// The rules of a response design that depend on the API's data and feed type. Pure functions
// (no database), so the same check runs on save, on load (has the data changed under a saved
// design?) and later in the upload guard (3.6).
//
//   problems  → the design can't be saved / can't be served as it is (400 DESIGN_INVALID)
//   warnings  → allowed, but worth knowing (missing mandatory Jivox fields, ...)
import type { ErrorDetail } from '../../../lib/app-error.js';
import type { FeedSchema } from '../../jivox/feed-schemas.js';
import { convertValue } from './convert.js';
import { RESPONSE_KEY, RESPONSE_KEY_MESSAGE, type StoredDesign } from './design.schemas.js';

export type DesignContext = {
  feedSchema: FeedSchema; // of the API's feed type
  columns: string[]; // of the API's data (active version), any names
  idColumn: string; // the data's id column: the source of the id field
};

export function checkDesign(design: StoredDesign, ctx: DesignContext) {
  const problems: ErrorDetail[] = [];
  const warnings: string[] = [];
  const { feedSchema, columns } = ctx;
  const jivoxFields = new Map(feedSchema.fields.map((f) => [f.name, f]));
  const columnSet = new Set(columns);

  // Response keys: unique, ignoring case ("Price" and "price" would only confuse). The id key
  // is the first one taken.
  const keys = new Map<string, string>([[design.idField.responseKey.toLowerCase(), 'the id']]);
  const usedJivox = new Map<string, number>();
  // Keys saved before Jivox's rule was known (a "-") show up as a problem; the live API keeps
  // answering with them until the design is saved again.
  if (!RESPONSE_KEY.test(design.idField.responseKey)) {
    problems.push({ field: 'idField.responseKey', message: `The id's key "${design.idField.responseKey}": ${RESPONSE_KEY_MESSAGE}` });
  }

  design.fields.forEach((field, i) => {
    const at = (name: string) => `fields.${i}.${name}`;
    const label = field.jivoxColumn;

    // 1. A field of this feed type's Jivox schema, used once; the id column is the id field.
    if (field.jivoxColumn === feedSchema.idColumn) {
      problems.push({
        field: at('jivoxColumn'),
        message: `${feedSchema.idColumn} is the id field: it's always sent first, from your id column`,
      });
    } else if (!jivoxFields.has(field.jivoxColumn)) {
      problems.push({
        field: at('jivoxColumn'),
        message: `"${field.jivoxColumn}" isn't a field of the Jivox ${feedSchema.feedType} feed`,
      });
    } else if (usedJivox.has(field.jivoxColumn)) {
      problems.push({
        field: at('jivoxColumn'),
        message: `${field.jivoxColumn} is already used by field ${usedJivox.get(field.jivoxColumn)! + 1}`,
      });
    } else {
      usedJivox.set(field.jivoxColumn, i);
    }

    // 2. The source must be a column of THIS data (any name; one column may feed several fields).
    if (!columnSet.has(field.sourceColumn)) {
      problems.push({
        field: at('sourceColumn'),
        message:
          columns.length === 0
            ? `${label}: this data has no columns yet. Upload a file first`
            : `${label}: your data has no column "${field.sourceColumn}"`,
      });
    }

    // 3. A key Jivox can read, unique.
    if (!RESPONSE_KEY.test(field.responseKey)) {
      problems.push({ field: at('responseKey'), message: `${label}: the key "${field.responseKey}": ${RESPONSE_KEY_MESSAGE}` });
    }
    const owner = keys.get(field.responseKey.toLowerCase());
    if (owner) {
      problems.push({
        field: at('responseKey'),
        message: `${label}: the key "${field.responseKey}" is already used by ${owner}`,
      });
    } else {
      keys.set(field.responseKey.toLowerCase(), label);
    }

    // 4. The default must be a value of the field's type (it's sent instead of the data).
    if (field.default.trim() !== '' && !convertValue(field.type, field.default).ok) {
      problems.push({
        field: at('default'),
        message: `${label}: the default "${field.default}" isn't ${TYPE_WORDS[field.type]}`,
      });
    }

    // Allowed but risky: type left out of the contract → Jivox uses ITS type for the field.
    const hint = jivoxFields.get(field.jivoxColumn)?.typeHint;
    if (!field.typeInContract && hint && hint !== field.type) {
      warnings.push(
        `${label}: the API sends it as ${field.type}, but the type is left out of the contract, ` +
          `so Jivox uses its own type for it (probably ${hint}).`,
      );
    }
  });

  const missingMandatory = feedSchema.fields
    .filter((f) => f.tier === 'mandatory' && f.name !== feedSchema.idColumn)
    .filter((f) => !usedJivox.has(f.name))
    .map((f) => f.name);
  if (missingMandatory.length > 0) {
    warnings.push(
      `Jivox marks these ${feedSchema.feedType} fields as mandatory and they aren't sent: ` +
        `${missingMandatory.join(', ')}. That's fine if the agent gets them from the uploaded feed.`,
    );
  }

  return { problems, warnings };
}

const TYPE_WORDS = {
  string: 'text',
  int: 'a whole number',
  float: 'a number',
  boolean: 'true/false (also yes/no, 1/0)',
  image: 'an http(s) image URL',
} as const;

// A response key made from a column name: "Product Title" → "Product_Title", "price€" → "price".
export function suggestResponseKey(column: string) {
  const key = column
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_]+/g, '_') // "sub-category" → "sub_category" (Jivox reads no "-")
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return key || 'id';
}
