// The request check (Phase 7, task 7.2, P7-4): each /v1 call compared with the API's request
// template, for the call log. "Did Jivox send what the contract says?"
//   GET   ids ✓ (3) · market = "US" ✓ · locale (chat context) ✓ · extra: debug
//   POST  items[].sku ✓ (3) · currency = "USD" ✓ · items[].cat missing for SKU-2049 ✗
// Pure (no database). Runs AFTER the answer went out (call-log.ts); the strict-mode switch (7.4)
// will use the same `ok`. Values are cut to 100 characters and scrubbed of token-shaped text.
import { scrubTokens } from '../../lib/logger.js';
import type { RequestTemplate } from '../apis/design/design.schemas.js';
import type { RequestSummary } from '../apis/design/request-rules.js';

const WHOLE_PLACEHOLDER = /^\{([^{}]+)\}$/;
const MAX_ITEMS = 40;
const MAX_TEXT = 100;
const MAX_IDS_NAMED = 10;
const MAX_ROWS_READ = 1_000;
const MAX_EXTRA = 20;

export type CheckItem = {
  part: 'method' | 'ids' | 'value' | 'context' | 'column';
  name: string; // "ids", "market", "context.currency", "items[].cat", "openai/locale"
  ok: boolean;
  expected?: string; // fixed values: what the template says
  got?: string; // what came (ids: how many)
  missingFor?: string[]; // per-row values: the rows (ids) without it, the first 10
};
export type RequestCheck = { ok: boolean; items: CheckItem[]; extra: string[] };

type Path = (string | number)[];

const cut = (text: string) => scrubTokens(text.slice(0, MAX_TEXT + 64)).slice(0, MAX_TEXT);
const show = (value: unknown) => cut(typeof value === 'string' ? value : JSON.stringify(value) ?? 'nothing');
const present = (value: unknown) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
const contextName = (placeholder: string) => placeholder.replace(/^_meta\./, '');
const pathText = (path: Path) => path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('').replace(/^\./, '');

function valueAt(root: unknown, path: Path): unknown {
  let current = root;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

// A GET query value as one text (?a=1&a=2 → "1,2", as /v1 reads ids).
const queryText = (value: unknown) => (Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : undefined);

// The check, plus the chat-context values that came in (`meta`, e.g. { "openai/locale": "en-US" }).
export function checkCall(
  request: RequestTemplate,
  summary: RequestSummary,
  method: string,
  query: Record<string, unknown>,
  body: unknown,
): { check: RequestCheck; meta: Record<string, string> | null } {
  const items: CheckItem[] = [];
  const meta: Record<string, string> = {};
  const extra: string[] = [];
  const done = () => {
    const shown = items.slice(0, MAX_ITEMS);
    return {
      check: { ok: items.every((i) => i.ok), items: shown, extra: extra.slice(0, MAX_EXTRA).map(cut) },
      meta: Object.keys(meta).length > 0 ? meta : null,
    };
  };

  if (method !== summary.method) {
    items.push({ part: 'method', name: 'method', ok: false, expected: summary.method, got: cut(method) });
    return done(); // nothing else can match: one clear line
  }

  if (summary.method === 'GET') {
    for (const [name, template] of Object.entries(request.query ?? {})) {
      const got = queryText(query[name]);
      const placeholder = typeof template === 'string' ? WHOLE_PLACEHOLDER.exec(template)?.[1] : undefined;
      if (name === summary.idParam) {
        const count = got ? got.split(',').filter((id) => id.trim() !== '').length : 0;
        items.push({ part: 'ids', name, ok: count > 0, got: String(count) });
      } else if (placeholder?.startsWith('_meta.')) {
        if (present(got)) meta[contextName(placeholder)] = cut(got!);
        items.push({ part: 'context', name: `${name} (${contextName(placeholder)})`, ok: present(got), ...(got !== undefined && { got: cut(got) }) });
      } else {
        items.push({ part: 'value', name, ok: got === String(template), expected: show(String(template)), ...(got !== undefined && { got: cut(got) }) });
      }
    }
    for (const name of Object.keys(query)) if (!(name in (request.query ?? {}))) extra.push(name);
    return done();
  }

  // POST: walk the body template; the per-row list is checked row by row.
  const rowsPath = summary.rowsPath;
  const isRows = (path: Path) => path.length === rowsPath.length && rowsPath.every((p, i) => p === path[i]);
  const walk = (template: unknown, path: Path) => {
    if (isRows(path)) return checkRows(template, path);
    if (typeof template === 'string') {
      const placeholder = WHOLE_PLACEHOLDER.exec(template)?.[1];
      const got = valueAt(body, path);
      if (placeholder?.startsWith('_meta.')) {
        if (present(got)) meta[contextName(placeholder)] = show(got);
        items.push({ part: 'context', name: `${pathText(path)} (${contextName(placeholder)})`, ok: present(got), ...(got !== undefined && { got: show(got) }) });
        return;
      }
    }
    if (template !== null && typeof template === 'object') {
      const entries = Array.isArray(template) ? template.map((v, i) => [i, v] as const) : Object.entries(template);
      for (const [key, value] of entries) walk(value, [...path, key]);
      return;
    }
    const got = valueAt(body, path);
    items.push({ part: 'value', name: pathText(path), ok: JSON.stringify(got) === JSON.stringify(template), expected: show(template), ...(got !== undefined && { got: show(got) }) });
  };

  const checkRows = (template: unknown, path: Path) => {
    const rowTemplate = (Array.isArray(template) ? template[0] : undefined) as Record<string, unknown> | undefined;
    const list = path.length === 0 ? body : valueAt(body, path);
    const where = path.length === 0 ? '[]' : `${pathText(path)}[]`;
    const rows = Array.isArray(list) ? list.slice(0, MAX_ROWS_READ) : [];
    const rowObject = (row: unknown) => (row !== null && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : {});
    const label = (row: unknown, i: number) => {
      const id = rowObject(row)[summary.idKey];
      return typeof id === 'string' || typeof id === 'number' ? cut(String(id)) : `row ${i + 1}`;
    };
    const withId = rows.filter((row) => present(rowObject(row)[summary.idKey])).length;
    items.push({ part: 'ids', name: `${where}.${summary.idKey}`, ok: rows.length > 0 && withId === rows.length, got: String(withId) });
    for (const [key, value] of Object.entries(rowTemplate ?? {})) {
      if (key === summary.idKey) continue;
      const placeholder = typeof value === 'string' ? WHOLE_PLACEHOLDER.exec(value)?.[1] : undefined;
      const missing: string[] = [];
      let missingCount = 0;
      rows.forEach((row, i) => {
        const got = rowObject(row)[key];
        const fine = placeholder ? present(got) : JSON.stringify(got) === JSON.stringify(value);
        if (!fine && ++missingCount <= MAX_IDS_NAMED) missing.push(label(row, i));
      });
      if (placeholder?.startsWith('_meta.')) {
        const first = rows.map((r) => rowObject(r)[key]).find(present);
        if (first !== undefined) meta[contextName(placeholder)] = show(first);
      }
      const part = placeholder ? (placeholder.startsWith('_meta.') ? 'context' : 'column') : 'value';
      items.push({
        part,
        name: part === 'column' ? `${where}.${key} (${placeholder})` : part === 'context' ? `${where}.${key} (${contextName(placeholder!)})` : `${where}.${key}`,
        ok: missingCount === 0,
        ...(part === 'value' && { expected: show(value) }),
        ...(missingCount > 0 && { missingFor: missing, got: `missing in ${missingCount} of ${rows.length}` }),
      });
    }
  };

  if (rowsPath.length === 0) checkRows(request.body, []);
  else walk(request.body, []);
  // Top-level body keys the template doesn't have (information only).
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && request.body !== null && typeof request.body === 'object' && !Array.isArray(request.body)) {
    for (const key of Object.keys(body)) if (!(key in request.body)) extra.push(key);
  }
  return done();
}
