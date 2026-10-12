// Reading Jivox's answers to submit_contract / activate_contract / list_contracts (task 6.4). Pure:
// docs/test-scripts/phase-06-task-6.4-answers-lib.test.ts.
//
// Jivox's REAL answers (qa3, 2026-10-12: docs/jivox/qa3-answers-2026-10-12/): submit → { status:
// "verified" | "invalid", version, note, contract, recorded, verification, errors[{ code, message }] };
// activate → { status: "active", version, contract, verification, previous_active }. `verification` =
// { passed, failure, http_status, status_ok, cache_control_ok, sent_ids, echoed_ids, id_check, api_errors,
// fields[{ column_name, pass, failure_reason }] }. A real FAILED answer hasn't been seen yet, so the
// reading stays LOOSE (other spellings / keys still work); anything unrecognised becomes "unknown" with
// Jivox's own word kept, and the raw answer is always stored and shown.
// Hints add OUR link to the place to fix a problem we recognise (P6-7); Jivox's words come first.
import type { FixPlace } from './contract-check.js';

export type JivoxProblem = { code: string | null; message: string; fix: string | null; path: string | null };
export type Hint = { text: string; place: FixPlace };
export type SubmitReading = {
  outcome: 'verified' | 'failed' | 'invalid' | 'gate_failed' | 'unknown';
  jivoxStatus: string | null;
  version: number | null;
  message: string | null;
  problems: JivoxProblem[];
  evidence: unknown;
  hints: Hint[];
};
export type ActivateReading = {
  outcome: 'activated' | 'refused' | 'unknown';
  jivoxStatus: string | null;
  version: number | null;
  retired: number | null;
  message: string | null;
  problems: JivoxProblem[];
  evidence: unknown;
  hints: Hint[];
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : typeof v === 'string' && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

function statusOf(a: Obj) {
  return str(a.status) ?? str(a.state) ?? str(a.result) ?? str(a.outcome);
}

// errors: [{ code, message, fix, path }] or ["text"], plus evidence.problems: ["text"]
function problemsOf(a: Obj): JivoxProblem[] {
  const list: JivoxProblem[] = [];
  const add = (p: unknown) => {
    if (typeof p === 'string') list.push({ code: null, message: p, fix: null, path: null });
    else {
      const o = obj(p);
      const message = str(o.message) ?? str(o.error) ?? str(o.detail) ?? str(o.reason);
      if (message || str(o.code)) list.push({ code: str(o.code), message: message ?? String(o.code), fix: str(o.fix) ?? str(o.hint) ?? str(o.how_to_fix), path: str(o.path) ?? str(o.field) });
    }
  };
  for (const key of ['errors', 'problems', 'issues', 'violations']) if (Array.isArray(a[key])) (a[key] as unknown[]).slice(0, 50).forEach(add);
  const ev = obj(a.evidence);
  if (Array.isArray(ev.problems)) (ev.problems as unknown[]).slice(0, 50).forEach(add);
  list.push(...verificationProblems(a.verification));
  return list;
}

// Jivox's `verification` (its live call to our API): only what did NOT pass becomes a problem.
function verificationProblems(value: unknown): JivoxProblem[] {
  const v = obj(value);
  if (Object.keys(v).length === 0 || v.passed === true) return [];
  const out: JivoxProblem[] = [];
  const add = (code: string, message: string) => out.push({ code, message, fix: null, path: null });
  const ids = (x: unknown) => (Array.isArray(x) ? x.slice(0, 10).map(String).join(', ') : '');
  const http = typeof v.http_status === 'number' ? v.http_status : null;
  if (http !== null && (http < 200 || http >= 300)) add('HTTP_STATUS', `HTTP ${http}: expected 2xx.`);
  if (v.status_ok === false) add('STATUS', 'The answer\'s status isn\'t "success".');
  if (v.cache_control_ok === false) add('CACHE_CONTROL', 'Cache-Control: no-store is missing.');
  const idc = obj(v.id_check);
  if (Array.isArray(idc.missing) && idc.missing.length) add('IDS_MISSING', `Ids sent but missing from the answer: ${ids(idc.missing)} (appears 0 times).`);
  if (Array.isArray(idc.duplicates) && idc.duplicates.length) add('IDS_DUPLICATED', `Ids that appear more than once: ${ids(idc.duplicates)}.`);
  if (Array.isArray(idc.unexpected) && idc.unexpected.length) add('IDS_UNEXPECTED', `Ids in the answer that weren't asked for: ${ids(idc.unexpected)}.`);
  if (typeof idc.without_id === 'number' && idc.without_id > 0) add('ITEMS_WITHOUT_ID', `${idc.without_id} item(s) without an id.`);
  if (Array.isArray(v.api_errors) && v.api_errors.length) add('API_ERRORS', `Our answer listed errors for: ${v.api_errors.slice(0, 10).map((e) => (typeof e === 'string' ? e : String(obj(e).error_id ?? JSON.stringify(e)))).join(', ')}.`);
  if (Array.isArray(v.fields)) {
    for (const f of v.fields.map(obj)) {
      if (f.pass === false) add('FIELD', `${str(f.column_name) ?? 'A field'}: ${str(f.failure_reason) ?? 'not of its type (or its default)'}.`);
    }
  }
  const failure = typeof v.failure === 'string' ? v.failure : v.failure ? JSON.stringify(v.failure) : null;
  if (failure && !out.some((p) => p.message.includes(failure))) out.unshift({ code: 'VERIFICATION', message: failure, fix: null, path: null });
  return out;
}

// OUR link for problems we recognise (by code first, then by words). Each place at most once.
const BY_CODE: Record<string, Hint> = {
  NOT_BOUND: { text: 'A field isn\'t bound to this agent: "Read from Jivox" again, or bind it in Studio.', place: 'agent' },
  NO_FIELDS: { text: 'The contract has no field bound to this agent: "Read from Jivox", then check the Design tab serves them.', place: 'agent' },
  MANDATORY_FIELD: { text: 'A mandatory field is in the contract: mandatory fields come from the feed, never from a Real Time Agent.', place: 'agent' },
  UNKNOWN_FIELD: { text: 'A field Jivox doesn\'t know is in the contract: check the agent\'s fields.', place: 'agent' },
  FEED_TYPE: { text: 'The agent serves another feed type: use an API of that feed type.', place: 'agent' },
  CREDENTIAL: { text: 'The credential doesn\'t match the agent\'s (we always send "service").', place: 'agent' },
  ID_PLACEHOLDER: { text: 'The request template\'s {item_id}: fix it on the Design tab (How Jivox calls it).', place: 'design' },
  BAD_META: { text: 'A context value in the request template isn\'t allowed: fix it on the Design tab.', place: 'design' },
  BAD_MAX_IDS: { text: 'Max ids per call: fix it on the Design tab (1–100).', place: 'design' },
  // from Jivox's `verification` (our codes, verificationProblems below)
  FIELD: { text: 'A value isn\'t of the type Jivox expects: change the type (or its column, or set a default) on the Design tab.', place: 'design' },
  CACHE_CONTROL: { text: 'The answer lacked Cache-Control: no-store (our API always sends it: check a proxy in between).', place: 'settings' },
  IDS_MISSING: { text: 'An id Jivox sent got no answer: use sample ids that exist in your data (Edit the agent), and check the id key.', place: 'agent' },
  ITEMS_WITHOUT_ID: { text: 'Some items have no id: check the id key on the Design tab.', place: 'design' },
  TOKEN_FORMAT: { text: 'The token header format: switch the header style on the Test tab (X-Api-Key or Bearer).', place: 'tokens' },
  BAD_BASE_URL: { text: 'The base URL: set PUBLIC_BASE_URL to the public https address.', place: 'settings' },
};
const BY_WORDS: [RegExp, Hint][] = [
  // Jivox's BAD_DOCUMENT for a key it can't read (qa3, 2026-10-12): "'$.data[*].sub-category' does not match '^\$\.data…'"
  [/\$\.data\[\*\]\.\S*' does not match/, { text: 'A response key Jivox can\'t read (only letters, numbers and _): rename it on the Design tab.', place: 'design' }],
  [/\b401\b|unauthori[sz]ed|missing token|token/i, { text: 'Our API refused Jivox\'s token: paste this agent\'s token in Studio (Real-time data → the agent → ACCESS KEYS → Agent access token).', place: 'studio' }],
  [/\b404\b|not published|not found/i, { text: 'Our API answered 404: publish the API (Overview) and check its address.', place: 'publish' }],
  [/expected (float|int|boolean|string|image)|type/i, { text: 'A value isn\'t of the type Jivox expects: change the type (or its column) on the Design tab.', place: 'design' }],
  [/appears 0 times|not found once|missing id|missing from the answer|sample/i, { text: 'An id Jivox sent got no answer: use sample ids that exist in your data (Edit the agent), and check the id key.', place: 'agent' }],
  [/no answer within|timed? ?out|timeout/i, { text: 'Our API answered too slowly for Jivox (3 s): check the live server is awake (the pinger) and not overloaded.', place: 'settings' }],
  [/could not reach|ECONN|ENOTFOUND|reach/i, { text: 'Jivox couldn\'t reach our API: check the public address (Render) is up.', place: 'settings' }],
  [/no-store|cache-control/i, { text: 'The answer lacked Cache-Control: no-store (our API always sends it: check a proxy in between).', place: 'settings' }],
];
export function hintsFor(problems: JivoxProblem[]): Hint[] {
  // When Jivox's call got a non-2xx status, the other problems (no ids, wrong status…) only follow
  // from it: point at that one cause, not at sample ids.
  const http = problems.find((p) => { const m = /\bHTTP (\d{3})\b/.exec(p.message); return m !== null && !m[1].startsWith('2'); });
  if (http) problems = [http];
  const out: Hint[] = [];
  const add = (h: Hint) => { if (!out.some((x) => x.place === h.place)) out.push(h); };
  for (const p of problems) {
    if (p.code && BY_CODE[p.code]) add(BY_CODE[p.code]);
    else for (const [re, h] of BY_WORDS) if (re.test(`${p.code ?? ''} ${p.message}`)) { add(h); break; }
  }
  return out;
}

export function readSubmit(answer: unknown): SubmitReading {
  const a = obj(answer);
  const status = statusOf(a);
  const word = status?.toLowerCase().replace(/[\s-]+/g, '_') ?? null;
  const outcome: SubmitReading['outcome'] =
    word === 'verified' || word === 'ok' || word === 'success' ? 'verified'
    : word === 'invalid' || word === 'validation_failed' ? 'invalid'
    : word === 'gate_failed' || word === 'gated' || word === 'gates_failed' ? 'gate_failed'
    : word === 'failed' || word === 'verification_failed' || word === 'rejected' ? 'failed'
    : 'unknown';
  const version = int(a.version) ?? int(obj(a.contract).version);
  const problems = problemsOf(a);
  // "verified" without a version number is not something we can act on: keep it as unknown.
  const final = outcome === 'verified' && version === null ? 'unknown' : outcome;
  return { outcome: final, jivoxStatus: status, version: final === 'verified' ? version : null, message: str(a.message) ?? str(a.note), problems, evidence: a.evidence ?? a.verification ?? null, hints: hintsFor(problems) };
}

export function readActivate(answer: unknown, asked: number): ActivateReading {
  const a = obj(answer);
  const status = statusOf(a);
  const word = status?.toLowerCase().replace(/[\s-]+/g, '_') ?? null;
  const outcome: ActivateReading['outcome'] =
    word === 'active' || word === 'activated' || word === 'ok' || word === 'success' ? 'activated'
    : word === 'refused' || word === 'rejected' || word === 'failed' || word === 'error' ? 'refused'
    : 'unknown';
  const problems = problemsOf(a);
  const reason = str(a.reason);
  if (outcome === 'refused' && reason && !problems.length) problems.push({ code: reason, message: str(a.message) ?? reason, fix: null, path: null });
  return {
    outcome,
    jivoxStatus: status,
    version: int(a.version) ?? asked,
    retired: int(a.retired) ?? int(a.previous_active) ?? int(obj(a.previous_active).version) ?? int(a.previous_version) ?? int(obj(a.retired).version),
    message: str(a.message) ?? str(a.note),
    problems,
    evidence: a.evidence ?? a.verification ?? null,
    hints: hintsFor(problems),
  };
}

// list_contracts → our shape. Versions oldest first; whatever else each one carries is kept as `extra`.
export function readVersions(answer: unknown) {
  const a = obj(answer);
  const raw = Array.isArray(a.contracts) ? a.contracts : Array.isArray(a.versions) ? a.versions : [];
  const active = int(a.active_version) ?? int(a.activeVersion);
  const versions = raw
    .map((v) => obj(v))
    .map((v) => ({ version: int(v.version), status: str(v.status), createdAt: str(v.created_at) ?? str(v.createdAt) ?? str(v.verified_at), extra: v }))
    .filter((v): v is { version: number; status: string | null; createdAt: string | null; extra: Obj } => v.version !== null)
    .sort((x, y) => x.version - y.version)
    .map(({ extra, ...v }) => ({ ...v, active: v.version === active || v.status === 'active', extra }));
  return { versions, activeVersion: active ?? versions.find((v) => v.active)?.version ?? null };
}
