// Test switches (Phase 7, task 7.4): /v1 answers WRONGLY on purpose, one mistake per switch, so the
// user can see Jivox catch each one (verification, activate's re-check, live chat).
//
// Who gets them: calls with a WORKING token of this API (like Jivox's), when the switch's scope
// matches (the whole API, or that one token = one agent). The app's own checks (self-check,
// checklist: they send the self-check header; Try it: in-app) only get switches with "apply to our
// own checks" ticked (P7-3). Expired switches are ignored at once (ends_at > now() in the query).
//
// Fixed order (several may be on together):
//   http_status → strict → [the answer is built] → empty_data → drop_id → duplicate_id → extra_id
//   → wrong_type → item_without_id → status_failure → [sending] slow → no_store → not_json
// Only switches that actually CHANGED the answer are recorded with the call (the call log).
import { scrubTokens } from '../../lib/logger.js';
import type { StoredDesign } from '../apis/design/design.schemas.js';
import { V1Error, type V1ErrorCode } from './envelope.js';
import type { RequestCheck } from './request-check.js';

export const SWITCH_KINDS = [
  'no_store', 'status_failure', 'duplicate_id', 'drop_id', 'extra_id', 'item_without_id',
  'wrong_type', 'slow', 'http_status', 'empty_data', 'not_json', 'strict',
] as const;
export type SwitchKind = (typeof SWITCH_KINDS)[number];
export const HTTP_STATUSES = [400, 401, 403, 404, 429, 500, 502, 503] as const;
export const SLOW_DEFAULT_MS = 3_500;
export const EXTRA_ID = 'NOT-REQUESTED-1';

// What each switch does, and what Jivox's real `verification` should then say (6.6 shapes).
export const SWITCH_CATALOGUE: { kind: SwitchKind; label: string; does: string; jivoxShould: string }[] = [
  { kind: 'no_store', label: 'No "no-store"', does: 'Leaves out Cache-Control: no-store', jivoxShould: 'cache_control_ok: false' },
  { kind: 'status_failure', label: 'Status "failure"', does: 'The envelope says status "failure" (data kept)', jivoxShould: 'status_ok: false' },
  { kind: 'duplicate_id', label: 'Duplicate an id', does: 'The first item is sent twice', jivoxShould: 'id_check: duplicates' },
  { kind: 'drop_id', label: 'Drop an id', does: 'The last asked id is left out of data AND errors', jivoxShould: 'id_check: missing' },
  { kind: 'extra_id', label: 'Extra id', does: `An item for an id nobody asked for ("${EXTRA_ID}")`, jivoxShould: 'id_check: unexpected' },
  { kind: 'item_without_id', label: 'Item without id', does: 'The first item loses its id key', jivoxShould: 'id_check: items without id' },
  { kind: 'wrong_type', label: 'Wrong type', does: 'A chosen field is sent with the wrong type (text → 12345, others → "abc")', jivoxShould: 'fields[]: pass false for that field' },
  { kind: 'slow', label: 'Slow answer', does: 'Waits before answering (default 3 500 ms; Jivox allows 3 s)', jivoxShould: 'a timeout failure' },
  { kind: 'http_status', label: 'HTTP status', does: 'Answers with the chosen HTTP status and a failure envelope', jivoxShould: 'http_status: the chosen code' },
  { kind: 'empty_data', label: 'Empty data', does: 'data: [] and errors: [] with status "success"', jivoxShould: 'id_check: all missing' },
  { kind: 'not_json', label: 'Not JSON', does: 'Plain text instead of JSON', jivoxShould: 'a parse failure' },
  { kind: 'strict', label: 'Strict mode', does: "Refuses (400) a call that doesn't match the request template", jivoxShould: 'nothing on a correct call; a 400 if Jivox sends something else' },
];

// One switch as /v1 sees it (from the token query).
export type LiveSwitch = { kind: SwitchKind; options: Record<string, unknown>; tokenId: string | null; own: boolean };

// Per call: which switches apply, and which really changed the answer (res.locals.v1Switches).
export type SwitchState = { active: LiveSwitch[]; applied: SwitchKind[] };
export const newSwitchState = (): SwitchState => ({ active: [], applied: [] });

export function inScope(sw: LiveSwitch, tokenId: string | null, ownCheck: boolean) {
  return (sw.tokenId === null || sw.tokenId === tokenId) && (!ownCheck || sw.own);
}

export const on = (state: SwitchState | undefined, kind: SwitchKind) => state?.active.find((s) => s.kind === kind);
const mark = (state: SwitchState, kind: SwitchKind) => {
  if (!state.applied.includes(kind)) state.applied.push(kind);
};

// ── Before the answer ──
const STATUS_CODE: Record<number, V1ErrorCode> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR', 502: 'BAD_GATEWAY', 503: 'SERVICE_BUSY',
};
export function httpStatusFailure(state: SwitchState): V1Error | null {
  const sw = on(state, 'http_status');
  if (!sw) return null;
  const status = Number(sw.options.status) || 500;
  mark(state, 'http_status');
  const retry: Record<string, string> = status === 429 || status === 503 ? { 'Retry-After': '1' } : {};
  return new V1Error(status, STATUS_CODE[status] ?? 'INTERNAL_ERROR', `Test switch on: this API answers HTTP ${status} on purpose.`, retry);
}

export function strictFailure(state: SwitchState, check: RequestCheck): V1Error | null {
  if (!on(state, 'strict') || check.ok) return null;
  mark(state, 'strict');
  const wrong = check.items
    .filter((i) => !i.ok)
    .slice(0, 5)
    .map((i) => {
      if (i.missingFor) return `${i.name} missing for ${i.missingFor.slice(0, 3).join(', ')}`;
      if (i.part === 'method') return `method: expected ${i.expected}, got ${i.got}`;
      if (i.got === undefined) return `${i.name}: missing`;
      return i.expected !== undefined ? `${i.name}: expected "${i.expected}", got "${i.got}"` : `${i.name}: ${i.got ? `"${i.got}"` : 'empty'}`;
    });
  return new V1Error(400, 'BAD_REQUEST', scrubTokens(`Strict mode (test switch): the call doesn't match this API's request. ${wrong.join('; ')}.`));
}

// ── The answer's body (a success envelope) ──
type Item = Record<string, unknown>;
export type Envelope = { status: string; generated_at: string; data: Item[]; errors: { error_id: string; error_code: string; error_message: string }[] };

export function applyToBody(state: SwitchState, body: Envelope, askedIds: string[], design: StoredDesign): Envelope {
  if (state.active.length === 0) return body;
  const idKey = design.idField.responseKey;
  let { data, errors, status } = body;
  data = data.map((item) => ({ ...item }));
  if (on(state, 'empty_data') && (data.length > 0 || errors.length > 0)) {
    data = [];
    errors = [];
    mark(state, 'empty_data');
  }
  const last = askedIds.at(-1);
  if (on(state, 'drop_id') && last !== undefined) {
    const before = data.length + errors.length;
    data = data.filter((item) => item[idKey] !== last);
    errors = errors.filter((e) => e.error_id !== last);
    if (data.length + errors.length < before) mark(state, 'drop_id');
  }
  if (on(state, 'duplicate_id') && data.length > 0) {
    data = [...data, { ...data[0] }];
    mark(state, 'duplicate_id');
  }
  if (on(state, 'extra_id')) {
    data = [...data, { ...(data[0] ?? {}), [idKey]: EXTRA_ID }];
    mark(state, 'extra_id');
  }
  const field = on(state, 'wrong_type')?.options.field;
  if (typeof field === 'string' && field !== idKey && data.some((item) => field in item)) {
    data = data.map((item) => (field in item ? { ...item, [field]: typeof item[field] === 'string' ? 12345 : 'abc' } : item));
    mark(state, 'wrong_type');
  }
  if (on(state, 'item_without_id') && data.length > 0 && idKey in data[0]) {
    const { [idKey]: _dropped, ...rest } = data[0];
    data = [rest, ...data.slice(1)];
    mark(state, 'item_without_id');
  }
  if (on(state, 'status_failure') && status !== 'failure') {
    status = 'failure';
    mark(state, 'status_failure');
  }
  return { ...body, status, data, errors };
}

// ── Sending ──
export const NOT_JSON_TEXT = 'Test switch on: this answer is not JSON.';
export function slowMs(state: SwitchState | undefined) {
  const sw = on(state, 'slow');
  if (!sw || !state) return 0;
  mark(state, 'slow');
  return Math.min(30_000, Math.max(1, Number(sw.options.ms) || SLOW_DEFAULT_MS));
}
export function dropsNoStore(state: SwitchState | undefined) {
  if (!state || !on(state, 'no_store')) return false;
  mark(state, 'no_store');
  return true;
}
export function sendsNotJson(state: SwitchState | undefined) {
  if (!state || !on(state, 'not_json')) return false;
  mark(state, 'not_json');
  return true;
}
