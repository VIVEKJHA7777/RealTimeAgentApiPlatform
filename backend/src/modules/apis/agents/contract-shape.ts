// A contract's SHAPE (task 5.6): the document without its sample answer and sample request.
// The shape is what Jivox holds on to (address, header, request template, fields, call rules); the
// sample parts change with every upload of new data and don't make a contract "out of date".
//
// When the user copies or downloads a contract we keep its shape; later we compare it with
// today's shape and list the changes in plain words ("sub_title removed", "request GET → POST").
// Pure: docs/test-scripts/phase-05-task-5.6-shape-lib.test.ts.
import { createHash } from 'node:crypto';

export type ContractShape = Record<string, unknown>;
type ShapeField = { column_name?: unknown; at?: unknown; type?: unknown; default_value?: unknown };
type ShapeRequest = { method?: unknown; path?: unknown; query?: unknown; body?: unknown };

const SAMPLE_KEYS = new Set(['response', 'sample_request']);
export const MAX_CHANGES = 20;

export function contractShape(document: Record<string, unknown>): ContractShape {
  return Object.fromEntries(Object.entries(document).filter(([key]) => !SAMPLE_KEYS.has(key)));
}

// JSON with object keys sorted at every level: Postgres JSONB keeps keys in its own order, so the
// same shape must give the same text whichever way it was stored. List order is kept (it matters).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const shapeHash = (shape: ContractShape) => createHash('sha256').update(canonicalJson(shape)).digest('hex');
export const sameShape = (a: ContractShape, b: ContractShape) => canonicalJson(a) === canonicalJson(b);

const show = (v: unknown) => (v === undefined ? 'none' : typeof v === 'string' ? (v === '' ? '""' : v) : canonicalJson(v));
const keyOf = (at: unknown) => (typeof at === 'string' ? at.replace(/^\$\.data\[\*\]\./, '') : show(at));
const fieldsOf = (shape: ContractShape) => (Array.isArray(shape.fields) ? (shape.fields as ShapeField[]) : []);
const requestOf = (shape: ContractShape) => (shape.request ?? {}) as ShapeRequest;
const header = (shape: ContractShape) =>
  shape.service_header === 'Authorization' ? `Authorization: ${show(shape.service_value_format)}` : `${show(shape.service_header)}: ${show(shape.service_value_format)}`;

// What changed from `before` (the contract the user took) to `after` (today's), in plain words.
// Empty = the same contract. At most MAX_CHANGES lines (+ "and N more").
export function shapeChanges(before: ContractShape, after: ContractShape): string[] {
  if (sameShape(before, after)) return [];
  const out: string[] = [];

  if (before.feed_type !== after.feed_type) out.push(`Feed type: ${show(before.feed_type)} → ${show(after.feed_type)}`);
  const [rb, ra] = [requestOf(before), requestOf(after)];
  const addressBefore = `${show(before.base_url)}${typeof rb.path === 'string' ? rb.path : ''}`;
  const addressAfter = `${show(after.base_url)}${typeof ra.path === 'string' ? ra.path : ''}`;
  if (addressBefore !== addressAfter) out.push(`Address: ${addressBefore} → ${addressAfter}`);
  if (before.credential !== after.credential) out.push(`Credential: ${show(before.credential)} → ${show(after.credential)}`);
  if (before.service_header !== after.service_header || before.service_value_format !== after.service_value_format) {
    out.push(`Token header: ${header(before)} → ${header(after)}`);
  }
  if (rb.method !== ra.method) out.push(`Request: ${show(rb.method)} → ${show(ra.method)}`);
  else if (canonicalJson(rb.query) !== canonicalJson(ra.query) || canonicalJson(rb.body) !== canonicalJson(ra.body)) {
    out.push(`Request template changed (${ra.method === 'POST' ? 'body' : 'query'})`);
  }

  // Fields by column name. The first one is the id (its key may change, it can't go away).
  const [fb, fa] = [fieldsOf(before), fieldsOf(after)];
  const byName = (list: ShapeField[]) => new Map(list.map((f) => [String(f.column_name), f]));
  const [mb, ma] = [byName(fb), byName(fa)];
  const idBefore = fb[0] ? String(fb[0].column_name) : null;
  for (const [name, f] of mb) {
    const now = ma.get(name);
    const label = name === idBefore ? `Id ${name}` : name;
    if (!now) {
      out.push(`${name} removed`);
      continue;
    }
    if (f.at !== now.at) out.push(`${label}: key ${keyOf(f.at)} → ${keyOf(now.at)}`);
    if (f.type !== now.type) {
      out.push(
        now.type === undefined ? `${label}: type left to Jivox (was ${show(f.type)})`
        : f.type === undefined ? `${label}: type ${show(now.type)} (was left to Jivox)`
        : `${label}: type ${show(f.type)} → ${show(now.type)}`,
      );
    }
    if (f.default_value !== now.default_value) out.push(`${label}: default ${show(f.default_value)} → ${show(now.default_value)}`);
  }
  for (const name of ma.keys()) if (!mb.has(name)) out.push(`${name} added`);
  const orderBefore = fb.map((f) => String(f.column_name)).filter((n) => ma.has(n));
  const orderAfter = fa.map((f) => String(f.column_name)).filter((n) => mb.has(n));
  if (orderBefore.join('\u0000') !== orderAfter.join('\u0000')) out.push('Fields in another order');

  const [cb, ca] = [(before.call_rules ?? {}) as Record<string, unknown>, (after.call_rules ?? {}) as Record<string, unknown>];
  if (cb.max_ids_per_call !== ca.max_ids_per_call) out.push(`Max ids per call: ${show(cb.max_ids_per_call)} → ${show(ca.max_ids_per_call)}`);
  else if (canonicalJson(cb) !== canonicalJson(ca)) out.push('Call rules changed');
  if (before.contract_format !== after.contract_format) out.push(`Format: ${show(before.contract_format)} → ${show(after.contract_format)}`);

  // Anything else (a key we don't describe yet): say so rather than claim "no changes".
  const known = new Set(['contract_format', 'feed_type', 'base_url', 'credential', 'service_header', 'service_value_format', 'request', 'fields', 'call_rules']);
  const others = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !known.has(k) && canonicalJson(before[k]) !== canonicalJson(after[k]));
  for (const key of others.sort()) out.push(`${key} changed`);
  if (out.length === 0) out.push('Contract changed'); // e.g. the request's path alone moved between keys

  return out.length > MAX_CHANGES ? [...out.slice(0, MAX_CHANGES - 1), `and ${out.length - MAX_CHANGES + 1} more`] : out;
}
