// The request design (task 3.4): HOW Jivox calls the API, stored as a contract/1 request
// template (P3-14). Pure functions (no database), like design-rules.ts.
//
//   GET   { "method": "GET",  "query": { "ids": "{item_id}", "locale": "{_meta.openai/locale}", "market": "US" } }
//   POST  { "method": "POST", "body":  { "items": [ { "sku": "{item_id}", "cat": "{category}" } ],
//                                        "context": { "locale": "{_meta.openai/locale}" }, "currency": "USD" } }
//
// Values in query / body:
//   "{<id>}"            the feed type's id column (item_id · review_id · store_id · content_id). REQUIRED,
//                       exactly once. GET: the ids joined by commas. POST: inside the ONE object of
//                       a one-element list, which becomes one object per row.
//   "{<column>}"        a Jivox column of this feed (Jivox fills it from its ingested row). POST
//                       only, and only inside that per-row object.
//   "{_meta.openai/locale}", "{_meta.openai/userLocation}"   chat context; anywhere.
//   anything else       a literal, copied as written.
// A placeholder is always a WHOLE string value: "id-{item_id}" is refused (Jivox doesn't
// fill placeholders inside text).
import type { ErrorDetail } from '../../../lib/app-error.js';
import type { FeedSchema } from '../../jivox/feed-schemas.js';
import type { RequestTemplate } from './design.schemas.js';

export const CONTEXT_KEYS = ['_meta.openai/locale', '_meta.openai/userLocation'];
const MAX_DEPTH = 10;
const MAX_NODES = 500;

const WHOLE_PLACEHOLDER = /^\{([^{}]+)\}$/;
const ANY_PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_./-]*\}/; // looks like one, somewhere in a text

type Path = (string | number)[];
type Found = { kind: 'id' | 'column' | 'context'; name: string; path: Path };

// What the /v1 runtime (Phase 4) and the contract (Phase 5) need to know about a valid request.
export type RequestSummary =
  | { method: 'GET'; idParam: string; context: { param: string; source: string }[] }
  | {
      method: 'POST';
      // body path of the list holding the per-row object ([] = the body itself is the list)
      rowsPath: Path;
      idKey: string; // key of the id inside each per-row object
      columns: { key: string; column: string }[]; // per-row {column} values
      context: { path: Path; source: string }[];
    };

export function defaultRequest(feedSchema: FeedSchema): RequestTemplate {
  return { method: 'GET', query: { ids: `{${feedSchema.idColumn}}` }, maxIdsPerCall: 100 };
}

export function checkRequest(request: RequestTemplate, feedSchema: FeedSchema) {
  const problems: ErrorDetail[] = [];
  const at = (path: Path, message: string) =>
    problems.push({ field: ['request', ...path].map(String).join('.'), message });
  const id = feedSchema.idColumn;
  const idText = `{${id}}`;
  const columns = new Set(feedSchema.fields.map((f) => f.name));
  const found: Found[] = [];
  let nodes = 0;
  let cutShort = false; // too deep / too big: the walk stopped, so "no {id}" may be untrue
  let otherFeedsId = false; // {item_id} on a store API: one clear message, not two

  // Records every placeholder with its path; refuses malformed / unknown ones on the spot.
  function walk(value: unknown, path: Path, depth: number) {
    if (++nodes > MAX_NODES) {
      cutShort = true;
      return; // reported once below
    }
    if (depth > MAX_DEPTH) {
      cutShort = true;
      at(path, `Nested too deep (at most ${MAX_DEPTH} levels)`);
      return;
    }
    if (typeof value === 'string') {
      const whole = WHOLE_PLACEHOLDER.exec(value);
      if (whole) {
        const name = whole[1];
        if (name === id) found.push({ kind: 'id', name, path });
        else if (name.startsWith('_meta.')) {
          if (CONTEXT_KEYS.includes(name)) found.push({ kind: 'context', name, path });
          else
            at(
              path,
              `Unknown chat context {${name}}: use ${CONTEXT_KEYS.map((k) => `{${k}}`).join(' or ')}`,
            );
        } else if (columns.has(name)) found.push({ kind: 'column', name, path });
        else if (/^(item|review|store|content)_id$/.test(name)) {
          otherFeedsId = true;
          at(path, `This is a ${feedSchema.feedType} API: its ids are ${idText}, not {${name}}`);
        } else at(path, `Unknown placeholder {${name}}: not a ${feedSchema.feedType} feed column`);
      } else if (ANY_PLACEHOLDER.test(value)) {
        at(path, 'A placeholder must be the whole value (e.g. "{item_id}"), not part of a text');
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, [...path, i], depth + 1));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (ANY_PLACEHOLDER.test(key))
          at([...path, key], 'Placeholders go in values, not in key names');
        walk(item, [...path, key], depth + 1);
      }
    }
  }

  const ids = () => found.filter((f) => f.kind === 'id');
  let summary: RequestSummary | null = null;

  if (request.method === 'GET') {
    if (request.body !== undefined) at(['body'], 'A GET request has no body: use query');
    if (!request.query) {
      at(['query'], `Add the query parameters, e.g. { "ids": "${idText}" }`);
      return { problems, summary };
    }
    for (const [key, value] of Object.entries(request.query)) walk(value, ['query', key], 1);
    for (const f of found.filter((x) => x.kind === 'column')) {
      at(
        f.path,
        `{${f.name}} (a per-row value) is POST only: a GET request sends the ids as one value`,
      );
    }
    if (ids().length === 0 && !otherFeedsId)
      at(['query'], `Add the ids parameter: one value must be exactly "${idText}"`);
    if (ids().length > 1)
      for (const f of ids().slice(1)) at(f.path, `${idText} may appear only once`);
    if (problems.length === 0) {
      summary = {
        method: 'GET',
        idParam: String(ids()[0].path[1]),
        context: found
          .filter((f) => f.kind === 'context')
          .map((f) => ({ param: String(f.path[1]), source: f.name })),
      };
    }
  } else {
    if (request.query !== undefined)
      at(['query'], 'A POST request has no query: put everything in body');
    if (request.body === undefined) {
      at(['body'], `Add the body, e.g. { "items": [ { "id": "${idText}" } ] }`);
      return { problems, summary };
    }
    if (request.body === null || typeof request.body !== 'object') {
      at(['body'], 'The body must be a JSON object or list');
      return { problems, summary };
    }
    walk(request.body, ['body'], 0);
    const idList = ids();
    if (idList.length === 0 && !otherFeedsId && !cutShort) {
      at(
        ['body'],
        `Put "${idText}" inside a one-item list of objects, e.g. "items": [ { "id": "${idText}" } ]`,
      );
    } else if (idList.length > 1) {
      for (const f of idList.slice(1)) at(f.path, `${idText} may appear only once`);
    }

    // The id's place: body … → list (exactly 1 item) → object → "key": "{id}"
    let rowPath: Path | null = null;
    if (idList.length === 1) {
      const p = idList[0].path; // ['body', ..., listIndex?, key]
      const key = p.at(-1);
      const index = p.at(-2);
      const list = valueAt(request, p.slice(0, -2));
      if (typeof key !== 'string' || typeof index !== 'number' || !Array.isArray(list)) {
        at(
          p,
          `On POST, ${idText} must sit in an object inside a list: [ { "id": "${idText}" } ] (not alone or in a plain list)`,
        );
      } else if (list.length !== 1) {
        at(
          p.slice(0, -2),
          `The list holding ${idText} must have exactly one object (it's the per-row template)`,
        );
      } else {
        rowPath = p.slice(0, -1);
      }
    }
    const insideRow = (path: Path) =>
      rowPath !== null &&
      path.length === rowPath.length + 1 &&
      rowPath.every((part, i) => path[i] === part);
    for (const f of found.filter((x) => x.kind === 'column')) {
      if (!insideRow(f.path))
        at(f.path, `{${f.name}} may sit only in the per-row object, next to ${idText}`);
    }
    if (problems.length === 0 && rowPath) {
      summary = {
        method: 'POST',
        rowsPath: rowPath.slice(1, -1),
        idKey: String(idList[0].path.at(-1)),
        columns: found
          .filter((f) => f.kind === 'column')
          .map((f) => ({ key: String(f.path.at(-1)), column: f.name })),
        context: found
          .filter((f) => f.kind === 'context')
          .map((f) => ({ path: f.path.slice(1), source: f.name })),
      };
    }
  }

  if (nodes > MAX_NODES)
    at([request.method === 'GET' ? 'query' : 'body'], `Too big: at most ${MAX_NODES} values`);
  return { problems, summary: problems.length === 0 ? summary : null };
}

function valueAt(root: unknown, path: Path): unknown {
  let current: unknown = root;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}
