// The WRITE side of the fake Jivox MCP server (task 6.2): submit_contract, list_contracts,
// activate_contract, acted out from Jivox's own spec (docs/jivox/mcp-snapshot-2026-10-12/
// get_contract_spec.json: rules, lifecycle, verification). Used by phase-05-fake-jivox-mcp.mjs.
//
// One fake "agent" per MCP URL PATH (e.g. /bound/sub_title): its own versions, its own Studio token.
//   submit   → validate → gates → ONE live verification call to the contract's base_url + path with
//              sample_request and the Studio token → verified (next version) | invalid | gate_failed |
//              failed (+ evidence). Every submit is recorded; only verified ones get a version.
//   list     → the verified versions (oldest first) + the active one. Failed and retired: never listed.
//   activate → only a verified version; gates + live call again; the old active one → retired (final).
// ANSWER SHAPES: verified + active + invalid as Jivox sent them on qa3 (2026-10-12,
// docs/jivox/qa3-answers-2026-10-12/): { note, status: 'verified', version, contract, recorded, verification }
// · { status: 'active', version, contract, created_at, updated_at, verification, previous_active }
// · { status: 'invalid', errors: [{ code, message }] } · { status: 'failed', version: null, recorded, verification }.
// Still guessed: gate_failed, refused (an activation that fails its re-check).
// Test-only control (POST /__control, same Bearer key): { path, studioToken?, submit?, activate?, reset? }
//   submit / activate: '' (real behaviour) | 'tool-error' | 'http500' | 'slow' (5 s, then real) | 'hang' (90 s)
//   GET /__state?path=… → the agent's versions + every call, for tests.

const VERIFY_TIMEOUT_MS = 3000; // contract/1 call rules
const ALLOWED_META = new Set(['_meta.openai/locale', '_meta.openai/userLocation']);

export function createWrites(schema) {
  const agents = new Map(); // path → { versions: [{ version, status, document, created_at }], next, studioToken, modes, calls }
  const types = new Map(schema.fields.map((f) => [f.field_name, f]));
  const agent = (path) => {
    if (!agents.has(path)) agents.set(path, { versions: [], next: 1, studioToken: null, modes: {}, calls: [] });
    return agents.get(path);
  };

  // ── 1. The document itself (the "invalid" step) ──
  function validate(doc) {
    const errors = [];
    const err = (code, path, message, fix) => errors.push({ code, path, message, fix });
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [{ code: 'NOT_AN_OBJECT', path: '$', message: 'The contract must be a JSON object.', fix: 'Send the document as an object.' }];
    if (doc.contract_format !== 'contract/1') err('BAD_FORMAT', '$.contract_format', `contract_format is "${doc.contract_format}".`, 'Set contract_format to "contract/1".');
    for (const k of ['feed_type', 'base_url', 'credential', 'request', 'fields', 'call_rules', 'sample_request']) {
      if (doc[k] === undefined) err('MISSING_KEY', `$.${k}`, `${k} is missing.`, `Add ${k} (see the template in get_contract_spec).`);
    }
    if (typeof doc.base_url === 'string' && !/^https?:\/\//.test(doc.base_url)) err('BAD_BASE_URL', '$.base_url', 'base_url must be an absolute http(s) URL.', 'Use the full address, e.g. https://api.example.com.');
    const placeholder = `{${schema.id_column}}`;
    const text = JSON.stringify(doc.request ?? {});
    const count = text.split(placeholder).length - 1;
    if (count !== 1) err('ID_PLACEHOLDER', '$.request', `${placeholder} appears ${count} times in the request.`, `Put ${placeholder} exactly once: the query value on GET, inside the one object of a one-element list on POST.`);
    for (const m of text.match(/\{_meta\.[^}]+\}/g) ?? []) {
      if (!ALLOWED_META.has(m.slice(1, -1))) err('BAD_META', '$.request', `${m} is not an allowed context key.`, 'Use _meta.openai/locale or _meta.openai/userLocation only.');
    }
    const max = doc.call_rules?.max_ids_per_call;
    if (!Number.isInteger(max) || max < 1 || max > 100) err('BAD_MAX_IDS', '$.call_rules.max_ids_per_call', `max_ids_per_call is ${JSON.stringify(max)}.`, 'Use a whole number from 1 to 100.');
    const header = doc[`${doc.credential}_value_format`];
    if (typeof header !== 'string' || header.split('{token}').length !== 2) err('TOKEN_FORMAT', `$.${doc.credential}_value_format`, 'The value format must hold {token} exactly once.', 'E.g. "Bearer {token}" or "{token}".');
    if (Array.isArray(doc.fields)) {
      if (doc.fields[0]?.column_name !== schema.id_column) err('ID_FIRST', '$.fields[0]', `The first field must be the id column ${schema.id_column}.`, `Start fields with { "column_name": "${schema.id_column}", "at": "$.data[*].<id key>" }.`);
      doc.fields.forEach((f, i) => {
        // Jivox's real rule and words (its first answer on qa3, 2026-10-12): code BAD_DOCUMENT, no fix.
        if (typeof f?.at !== 'string' || !/^\$\.data\[\*\]\.[A-Za-z0-9_]+$/.test(f.at)) errors.push({ code: 'BAD_DOCUMENT', message: `'${f?.at}' does not match '^\\$\\.data\\[\\*\\]\\.[A-Za-z0-9_]+$'` });
      });
    } else if (doc.fields !== undefined) err('BAD_FIELDS', '$.fields', 'fields must be a list.', 'List the id first, then the bound fields.');
    return errors;
  }

  // ── 2. The gates (the agent's facts) ──
  function gates(doc, bound) {
    const errors = [];
    const err = (code, message, fix) => errors.push({ code, message, fix });
    if (doc.feed_type !== schema.feed_type) err('FEED_TYPE', `This agent serves the ${schema.feed_type} feed, not ${doc.feed_type}.`, `Set feed_type to "${schema.feed_type}".`);
    if (doc.credential !== 'service') err('CREDENTIAL', `This agent's registered credential is "service", not "${doc.credential}".`, 'Set credential to "service".');
    const outputs = (doc.fields ?? []).slice(1).map((f) => f.column_name);
    if (outputs.length === 0) err('NO_FIELDS', 'fields lists no field bound to this agent.', `Add at least one of: ${bound.join(', ')}.`);
    for (const name of outputs) {
      const f = types.get(name);
      if (!f) err('UNKNOWN_FIELD', `"${name}" is not a ${schema.feed_type} field.`, 'Use column names from get_canonical_schema.');
      else if (f.tier === 'mandatory') err('MANDATORY_FIELD', `"${name}" is mandatory: it comes from the feed.`, `Remove ${name} from fields.`);
      else if (!bound.includes(name)) err('NOT_BOUND', `"${name}" is not bound to this agent.`, `Remove it, or bind it to this agent in Studio. Bound: ${bound.join(', ')}.`);
    }
    return errors;
  }

  // ── 3. The live verification call ──
  // The ids sent: GET → the query value that held {id}, split on commas; POST → the key next to {id}
  // in the one-object list, read from every object of the same list in sample_request.
  function sentIds(doc) {
    const ph = `{${schema.id_column}}`;
    if (doc.request.method === 'GET') {
      const key = Object.keys(doc.request.query ?? {}).find((k) => doc.request.query[k] === ph);
      return key ? String(doc.sample_request?.[key] ?? '').split(',').filter(Boolean) : [];
    }
    const walk = (tpl, sample) => {
      if (Array.isArray(tpl) && tpl.length === 1 && tpl[0] && typeof tpl[0] === 'object') {
        const key = Object.keys(tpl[0]).find((k) => tpl[0][k] === ph);
        if (key && Array.isArray(sample)) return sample.map((o) => String(o?.[key]));
      }
      if (tpl && typeof tpl === 'object') {
        for (const k of Object.keys(tpl)) {
          const r = walk(tpl[k], sample?.[k]);
          if (r) return r;
        }
      }
      return null;
    };
    return walk(doc.request.body, doc.sample_request) ?? [];
  }

  const ofType = (value, type) =>
    type === 'int' ? Number.isInteger(value)
    : type === 'float' ? typeof value === 'number' && Number.isFinite(value)
    : type === 'boolean' ? typeof value === 'boolean'
    : typeof value === 'string';

  async function verify(doc, studioToken) {
    const url = new URL(doc.base_url.replace(/\/+$/, '') + doc.request.path);
    const headers = { Accept: 'application/json' };
    // The token from "Studio" (the parameter store); no token registered → the call goes without one.
    if (studioToken) headers[doc[`${doc.credential}_header`]] = doc[`${doc.credential}_value_format`].replace('{token}', studioToken);
    let body;
    if (doc.request.method === 'GET') for (const [k, v] of Object.entries(doc.sample_request ?? {})) url.searchParams.set(k, String(v));
    else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(doc.sample_request);
    }
    // Evidence never shows the token (like any sane platform): the header is named, its value masked.
    const request = { method: doc.request.method, url: url.toString(), headers: Object.keys(headers).map((h) => (h === doc[`${doc.credential}_header`] ? `${h}: [token]` : `${h}: ${headers[h]}`)), ...(body && { body: JSON.parse(body) }) };
    const problems = [];
    let res;
    const started = Date.now();
    try {
      res = await fetch(url, { method: doc.request.method, headers, body, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS), redirect: 'manual' });
    } catch (e) {
      problems.push(e.name === 'TimeoutError' ? `No answer within ${VERIFY_TIMEOUT_MS} ms.` : `Could not reach the API: ${e.cause?.code ?? e.message}.`);
      return { ok: false, evidence: { request, response: null, problems }, verification: { url: url.toString().split('?')[0], method: doc.request.method, passed: false, failure: problems[0], http_status: null } };
    }
    const ms = Date.now() - started;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const response = { status: res.status, cache_control: res.headers.get('cache-control'), time_ms: ms, body: json ?? text.slice(0, 2000) };
    if (res.status < 200 || res.status >= 300) problems.push(`HTTP ${res.status}: expected 2xx.`);
    if (!/\bno-store\b/i.test(res.headers.get('cache-control') ?? '')) problems.push('Cache-Control: no-store is missing.');
    if (json?.status !== 'success') problems.push(`status is ${JSON.stringify(json?.status)}: expected "success".`);
    const data = Array.isArray(json?.data) ? json.data : [];
    const [idField, ...outputs] = doc.fields;
    const idKey = idField.at.replace('$.data[*].', '');
    for (const id of sentIds(doc)) {
      const n = data.filter((item) => String(item?.[idKey]) === id).length;
      if (n !== 1) problems.push(`id ${id} appears ${n} times at ${idField.at}: expected exactly once.`);
    }
    for (const f of outputs) {
      const key = f.at.replace('$.data[*].', '');
      const type = f.type ?? types.get(f.column_name)?.type ?? 'string';
      for (const item of data) {
        // Missing → falls back to the default. Present → must be of the type.
        if (item && Object.hasOwn(item, key) && !ofType(item[key], type)) {
          problems.push(`${f.column_name} at ${f.at} for id ${item[idKey]} is ${JSON.stringify(item[key])}: expected ${type}.`);
        }
      }
    }
    // Jivox's real shape (qa3, 2026-10-12): the same facts as `verification`.
    const sent = sentIds(doc);
    const echoed = data.map((item) => String(item?.[idKey]));
    const verification = {
      url: url.toString().split('?')[0], method: doc.request.method, passed: problems.length === 0, failure: problems[0] ?? null,
      http_status: res.status, status_ok: json?.status === 'success', cache_control_ok: /\bno-store\b/i.test(res.headers.get('cache-control') ?? ''),
      sent_ids: sent, echoed_ids: echoed,
      id_check: { missing: sent.filter((id) => !echoed.includes(id)), duplicates: [...new Set(echoed.filter((id, i) => echoed.indexOf(id) !== i))], unexpected: echoed.filter((id) => !sent.includes(id)), without_id: data.filter((item) => item?.[idKey] === undefined).length },
      api_errors: Array.isArray(json?.errors) ? json.errors.map((e) => e?.error_id) : [],
      fields: outputs.map((f) => { const p = problems.find((x) => x.startsWith(`${f.column_name} at`)); return { column_name: f.column_name, pass: !p, failure_reason: p ?? null }; }),
      test_user_token: 'used once and discarded; not stored, not logged',
    };
    return { ok: problems.length === 0, evidence: { request, response, problems }, verification };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // → { forced } (the server sends that failure itself) or { result } (a normal tool answer)
  async function forced(mode) {
    if (mode === 'slow') await sleep(5000);
    if (mode === 'hang') await sleep(90_000);
    if (mode === 'tool-error') return { toolError: 'internal error while handling the contract' };
    if (mode === 'http500') return { http500: true };
    return null;
  }

  return {
    async submit(path, bound, args) {
      const a = agent(path);
      const f = await forced(a.modes.submit);
      if (f) return f;
      const doc = args?.contract;
      const record = (result) => {
        a.calls.push({ tool: 'submit_contract', at: new Date().toISOString(), result: result.status, version: result.version ?? null });
        return { result };
      };
      const invalid = validate(doc);
      if (invalid.length) return record({ status: 'invalid', errors: invalid, message: 'The document is not a valid contract/1. Fix each error and submit again.' });
      const gated = gates(doc, bound);
      if (gated.length) return record({ status: 'gate_failed', errors: gated, message: 'The contract does not fit this agent. Fix each error and submit again.' });
      const v = await verify(doc, a.studioToken);
      // failed: the real shape is not known yet (guess: verification + our evidence); verified: as qa3 sent it.
      if (!v.ok) return record({ status: 'failed', version: null, recorded: true, verification: v.verification }); // as qa3 sent it
      const version = a.next++;
      a.versions.push({ version, status: 'verified', document: doc, created_at: new Date().toISOString() });
      return record({ note: `Call activate_contract(version=${version}) to make it live.`, status: 'verified', version, contract: doc, recorded: true, verification: v.verification });
    },

    list(path) {
      const a = agent(path);
      const listed = a.versions.filter((v) => v.status === 'verified' || v.status === 'active');
      return {
        contracts: listed.map((v) => ({ version: v.version, status: v.status, created_at: v.created_at, fields: v.document.fields.map((f) => f.column_name) })),
        active_version: listed.find((v) => v.status === 'active')?.version ?? null,
      };
    },

    async activate(path, bound, args) {
      const a = agent(path);
      const f = await forced(a.modes.activate);
      if (f) return f;
      const record = (result) => {
        a.calls.push({ tool: 'activate_contract', at: new Date().toISOString(), result: result.status, version: args?.version ?? null });
        return { result };
      };
      const target = a.versions.find((v) => v.version === args?.version);
      if (!target) return record({ status: 'refused', reason: 'unknown_version', message: `There is no version ${args?.version} for this agent.` });
      if (target.status === 'active') return record({ status: 'refused', reason: 'already_active', message: `Version ${target.version} is already active.` });
      if (target.status !== 'verified') return record({ status: 'refused', reason: 'not_verified', message: `Version ${target.version} is ${target.status}: only a verified version can be activated.` });
      const gated = gates(target.document, bound);
      if (gated.length) return record({ status: 'refused', reason: 'gate_failed', errors: gated, message: 'The version no longer fits the agent.' });
      const v = await verify(target.document, a.studioToken);
      if (!v.ok) return record({ status: 'refused', reason: 'verification_failed', verification: v.verification, message: 'The live verification call failed again; nothing changed.' }); // guessed
      const previous = a.versions.find((x) => x.status === 'active');
      if (previous) previous.status = 'retired';
      target.status = 'active';
      // as qa3 sent it (previous_active: null when nothing was active; a number is our guess otherwise)
      return record({ status: 'active', version: target.version, contract: target.document, created_at: target.created_at, updated_at: new Date().toISOString(), verification: v.verification, previous_active: previous?.version ?? null });
    },

    has: (path) => agents.has(path) && agents.get(path).versions.length + agents.get(path).calls.length > 0,

    control(input) {
      if (input.reset) agents.delete(input.path);
      const a = agent(input.path);
      if (input.studioToken !== undefined) a.studioToken = input.studioToken || null;
      for (const k of ['submit', 'activate']) if (input[k] !== undefined) a.modes[k] = input[k] || undefined;
      return { ok: true };
    },

    state: (path) => {
      const a = agent(path);
      return { versions: a.versions.map(({ document, ...v }) => ({ ...v, fields: document.fields.map((f) => f.column_name) })), calls: a.calls, studioToken: a.studioToken ? 'set' : null, modes: a.modes };
    },
  };
}
