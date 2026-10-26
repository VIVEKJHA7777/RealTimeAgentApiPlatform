// Turns stored rows into what the API answers, following a design. Pure functions (no
// database): used by the design preview (task 3.5) and, unchanged, by the live /v1 endpoint
// (Phase 4), so the preview shows EXACTLY what Jivox will get.
//
// The dictated contract/1 envelope:
//   { "status": "success", "generated_at": "<ISO>", "data": [ {flat item per id} ],
//     "errors": [ { "error_id", "error_code", "error_message" } ] }
import { convertValue } from './convert.js';
import type { RequestTemplate, StoredDesign } from './design.schemas.js';
import type { RequestSummary } from './request-rules.js';

export type StoredRow = { externalId: string; data: Record<string, string | null> };
export type Item = Record<string, string | number | boolean | string[]>;
// Something in a row that didn't go out as written (shown in the preview).
export type ValueNote = {
  id: string;
  responseKey: string;
  column: string;
  value: string | null;
  used: string;
};

// One row → one flat item: the id first, then the fields in design order.
//   value fits the type      → converted value ("79.99" → 79.99)
//   value doesn't fit        → onMismatch "send": sent as written (text) · "default": as if empty
//   empty                    → the default (converted); no default → onEmpty: "" (empty_string,
//                              the default) or the key is LEFT OUT (omit)
export function buildItem(row: StoredRow, design: StoredDesign, idColumn: string) {
  const item: Item = { [design.idField.responseKey]: row.externalId };
  const notes: ValueNote[] = [];
  for (const field of design.fields) {
    const raw =
      field.sourceColumn === idColumn ? row.externalId : (row.data[field.sourceColumn] ?? null);
    if (raw !== null && raw.trim() !== '') {
      const converted = convertValue(field.type, raw);
      if (converted.ok) {
        item[field.responseKey] = converted.value;
        continue;
      }
      // Designs saved before this option existed have no onMismatch: "send" like new fields.
      if ((field.onMismatch ?? 'send') === 'send') {
        item[field.responseKey] = raw;
        notes.push({
          id: row.externalId,
          responseKey: field.responseKey,
          column: field.sourceColumn,
          value: raw,
          used: `sent as written (text, not ${field.type})`,
        });
        continue;
      }
    }
    // Missing or wrong type → default. (Defaults are checked against the type when saved.)
    const fallback = field.default.trim() === '' ? null : convertValue(field.type, field.default);
    // Designs saved before this option existed have no onEmpty: "" like new fields.
    const omit = (field.onEmpty ?? 'empty_string') === 'omit';
    if (fallback?.ok) item[field.responseKey] = fallback.value;
    else if (!omit) item[field.responseKey] = '';
    notes.push({
      id: row.externalId,
      responseKey: field.responseKey,
      column: field.sourceColumn,
      value: raw,
      used: fallback?.ok ? `default ${JSON.stringify(fallback.value)}` : omit ? 'left out (no default)' : 'sent as "" (no default)',
    });
  }
  return { item, notes };
}

// The answer for a list of asked ids: one item per id found (in the order asked, each id
// once), unknown ids in `errors`.
export function buildResponse(
  askedIds: string[],
  rowsById: Map<string, StoredRow>,
  design: StoredDesign,
  idColumn: string,
  now = new Date(),
) {
  const data: Item[] = [];
  const errors: { error_id: string; error_code: string; error_message: string }[] = [];
  const notes: ValueNote[] = [];
  for (const id of new Set(askedIds)) {
    const row = rowsById.get(id);
    if (!row) {
      errors.push({ error_id: id, error_code: 'NOT_FOUND', error_message: 'unknown id' });
      continue;
    }
    const built = buildItem(row, design, idColumn);
    data.push(built.item);
    notes.push(...built.notes);
  }
  return {
    response: {
      status: 'success' as const,
      generated_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), // "2026-10-11T10:00:00Z"
      data,
      errors,
    },
    notes,
  };
}

// The request Jivox sends for these ids: the contract's `sample_request` (what verification
// sends: context values are NEVER sent then, so their keys are dropped).
//   GET  → the query, the id parameter = the ids joined by commas
//   POST → the body, the per-row list = one object per id; {column} values from `columnValue`
//          (the preview fills them from OUR data when a field maps that Jivox column)
export function buildSampleRequest(
  request: RequestTemplate,
  summary: RequestSummary,
  ids: string[],
  columnValue: (id: string, jivoxColumn: string) => string,
) {
  if (summary.method === 'GET') {
    const query: Record<string, string | number | boolean> = {};
    const contextParams = new Set(summary.context.map((c) => c.param));
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (key === summary.idParam) query[key] = ids.join(',');
      else if (!contextParams.has(key)) query[key] = value;
    }
    return { method: 'GET' as const, query };
  }

  const body = dropContext(structuredClone(request.body)) as unknown;
  const rowTemplate = getAt(request.body, [...summary.rowsPath, 0]) as Record<string, unknown>;
  const rows = ids.map((id) => {
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rowTemplate)) {
      if (key === summary.idKey) row[key] = id;
      else if (isContext(value))
        continue; // dropped at verification
      else {
        const column = summary.columns.find((c) => c.key === key);
        row[key] = column ? columnValue(id, column.column) : value;
      }
    }
    return row;
  });
  return { method: 'POST' as const, body: setAt(body, summary.rowsPath, rows) };
}

const isContext = (value: unknown) =>
  typeof value === 'string' && /^\{_meta\.[^{}]+\}$/.test(value);

// Removes every context value (and its key) at any depth. An object (or list) left EMPTY by that is
// removed too, like Jivox's own Sample B: { "context": { "locale": "{_meta.openai/locale}" } }
// disappears entirely at verification. One that was empty in the template stays as written.
const EMPTIED = Symbol('emptied by context');
function dropContext(value: unknown): unknown {
  const out = dropContextIn(value);
  return out === EMPTIED ? {} : out;
}
function dropContextIn(value: unknown): unknown {
  if (Array.isArray(value)) {
    const kept = value.filter((v) => !isContext(v)).map(dropContextIn).filter((v) => v !== EMPTIED);
    return value.length > 0 && kept.length === 0 ? EMPTIED : kept;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    const kept = entries
      .filter(([, v]) => !isContext(v))
      .map(([k, v]) => [k, dropContextIn(v)] as const)
      .filter(([, v]) => v !== EMPTIED);
    return entries.length > 0 && kept.length === 0 ? EMPTIED : Object.fromEntries(kept);
  }
  return value;
}

type Path = (string | number)[];
function getAt(root: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (node, part) => (node as Record<string | number, unknown>)?.[part],
    root,
  );
}
function setAt(root: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  (getAt(root, path.slice(0, -1)) as Record<string | number, unknown>)[path.at(-1)!] = value;
  return root;
}

// The GET URL as Jivox builds it: values URL-encoded (the commas between ids become %2C).
export function queryString(query: Record<string, string | number | boolean>) {
  return new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
}
