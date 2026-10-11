// The contract checklist (Phase 5, task 5.4): everything Jivox will check for ONE agent's contract,
// each ✓ / ✗ / ⚠ / skipped with the reason and where to fix it. "Ready" = no ✗ (⚠ allowed).
//
//   Jivox agent   read from Jivox · feed type · fields served by the design · only bound fields ·
//                 Jivox's types · POST {column} inputs
//   Contract      follows contract/1 · base URL Jivox can reach · sample ids answered
//   Token         the agent's token is usable · a token is registered in Studio
//   Live call     the contract's own sample_request sent to our live URL with the agent's token, the
//                 way Jivox's verification sends it: 2xx · no-store · success · every id once at the
//                 id path · every contract field of its type (or its default) · < 3 s · refused
//                 without a token. Sent with the self-check header: not counted, not in Recent calls.
import type { Api } from '../../../generated/prisma/client.js';
import { decryptToken, tokenState } from '../../../lib/api-token.js';
import { prisma } from '../../../lib/prisma.js';
import { getFeedSchema } from '../../jivox/feed-schemas.js';
import type { FIELD_TYPES } from '../design/design.schemas.js';
import { callLive, describeRequest, errorText, JIVOX_TIME_LIMIT_MS, listed, LIVE_TIMEOUT_MS, matchesType, show } from '../testing/testing.service.js';
import type { JivoxAgentInfo } from './agents.service.js';
import { prepareAgentContract } from './contract.js';

type Status = 'pass' | 'fail' | 'warn' | 'skip';
// Where the user fixes it (the screen shows a link / hint for each).
export type FixPlace = 'design' | 'agent' | 'studio' | 'publish' | 'tokens' | 'settings' | 'data';
export type ContractCheck = { id: string; group: 'agent' | 'contract' | 'token' | 'live'; label: string; status: Status; detail: string; fix?: { place: FixPlace; text: string } };
type FieldType = (typeof FIELD_TYPES)[number];
type DocField = { column_name: string; at: string; type?: string; default_value: string };

const keyOf = (at: string) => at.replace(/^\$\.data\[\*\]\./, '');

export async function checkAgentContract(api: Api, brandSlug: string, agentId: string) {
  const p = await prepareAgentContract(api, brandSlug, agentId);
  const { agent, info, ctx, document, notes } = p;
  const checks: ContractCheck[] = [];
  const add = (c: ContractCheck) => checks.push(c);
  const note = (code: string) => notes.filter((n) => n.code === code);
  const fields = document.fields as DocField[];
  const agentFields = fields.slice(1);

  // ── Jivox agent ──
  add(info
    ? { id: 'jivox_read', group: 'agent', label: 'Agent read from Jivox', status: 'pass', detail: `Bound in Studio: ${info.boundFields.join(', ') || 'nothing'}` }
    : { id: 'jivox_read', group: 'agent', label: 'Agent read from Jivox', status: 'warn', detail: 'Fields picked by hand. Save the access key and use "Read from Jivox" so the fields match what you selected in Studio.', fix: { place: 'agent', text: 'Read from Jivox' } });
  add(!info
    ? { id: 'feed_type', group: 'agent', label: 'Same feed type as the agent', status: 'skip', detail: 'Known once the agent is read from Jivox' }
    : info.feedType === ctx.feedType && info.idColumn === getFeedSchema(ctx.feedType).idColumn
      ? { id: 'feed_type', group: 'agent', label: 'Same feed type as the agent', status: 'pass', detail: `${info.feedType}, id ${info.idColumn}` }
      : { id: 'feed_type', group: 'agent', label: 'Same feed type as the agent', status: 'fail', detail: `Jivox says this agent serves the ${info.feedType} feed (id ${info.idColumn}); this API serves ${ctx.feedType}. Use an API of that feed type for it.`, fix: { place: 'agent', text: 'Move the agent to an API of the right feed type' } });

  const missing = note('FIELD_NOT_IN_DESIGN').map((n) => n.field!);
  add(agentFields.length === 0
    ? { id: 'fields', group: 'agent', label: 'Fields answered by this API', status: 'fail', detail: note('NO_FIELDS')[0]?.message ?? 'No fields', fix: { place: agent.fields.length === 0 ? 'agent' : 'design', text: agent.fields.length === 0 ? 'Read from Jivox (or pick fields)' : 'Add the fields on the Design tab' } }
    : missing.length > 0
      ? { id: 'fields', group: 'agent', label: 'Fields answered by this API', status: 'warn', detail: `${agentFields.map((f) => f.column_name).join(', ')} answered live. Not in the design, so Jivox keeps the feed's value: ${missing.join(', ')}.`, fix: { place: 'design', text: `Add ${missing.join(', ')} on the Design tab` } }
      : { id: 'fields', group: 'agent', label: 'Fields answered by this API', status: 'pass', detail: agentFields.map((f) => `${f.column_name} → ${keyOf(f.at)}`).join(', ') });

  if (!info) {
    add({ id: 'bound', group: 'agent', label: 'Only fields bound to this agent', status: 'skip', detail: 'Known once the agent is read from Jivox' });
  } else {
    const unbound = agentFields.filter((f) => !info.boundFields.includes(f.column_name)).map((f) => f.column_name);
    add(unbound.length === 0
      ? { id: 'bound', group: 'agent', label: 'Only fields bound to this agent', status: 'pass', detail: `${agentFields.length} of ${info.boundFields.length} bound field${info.boundFields.length === 1 ? '' : 's'}` }
      : { id: 'bound', group: 'agent', label: 'Only fields bound to this agent', status: 'fail', detail: `Not bound to this agent in Studio (Jivox refuses them): ${unbound.join(', ')}.`, fix: { place: 'agent', text: 'Read from Jivox again, or select them for this agent in Studio' } });
  }

  const typeNotes = note('TYPE_DIFFERS');
  add(typeNotes.length === 0
    ? { id: 'types', group: 'agent', label: "Types match Jivox's", status: agentFields.length ? 'pass' : 'skip', detail: agentFields.length ? agentFields.map((f) => `${f.column_name}: ${f.type ?? 'Jivox decides'}`).join(', ') : 'No fields' }
    : { id: 'types', group: 'agent', label: "Types match Jivox's", status: 'fail', detail: typeNotes.map((n) => n.message).join(' '), fix: { place: 'design', text: 'Change the type on the Design tab' } });

  if (ctx.summary.method !== 'POST' || ctx.summary.columns.length === 0) {
    add({ id: 'inputs', group: 'agent', label: 'Per-row inputs ({column})', status: 'skip', detail: ctx.summary.method === 'GET' ? 'GET sends only ids and fixed values' : 'None in the request' });
  } else {
    // A field bound to ANY realtime agent is never an input (Jivox's rule). We know this API's agents.
    const others = await prisma.jivoxAgent.findMany({ where: { apiId: api.id }, select: { fields: true, agentInfo: true } });
    const realtime = new Set(others.flatMap((a) => [...a.fields, ...((a.agentInfo as JivoxAgentInfo | null)?.boundFields ?? [])]));
    const asRealtime = ctx.summary.columns.filter((c) => realtime.has(c.column)).map((c) => `{${c.column}}`);
    const unmapped = ctx.summary.columns.filter((c) => !ctx.runtime.design.fields.some((f) => f.jivoxColumn === c.column)).map((c) => `{${c.column}}`);
    add(asRealtime.length > 0
      ? { id: 'inputs', group: 'agent', label: 'Per-row inputs ({column})', status: 'fail', detail: `${asRealtime.join(', ')} ${asRealtime.length === 1 ? 'is a field' : 'are fields'} a Real Time Agent answers: Jivox never sends those as inputs.`, fix: { place: 'design', text: 'Remove it from the request on the Design tab' } }
      : unmapped.length > 0
        ? { id: 'inputs', group: 'agent', label: 'Per-row inputs ({column})', status: 'warn', detail: `The sample request sends "" for ${unmapped.join(', ')}: no design field maps that Jivox column (Jivox fills it from its feed at serve time).`, fix: { place: 'design', text: 'Map that column on the Design tab for a real sample value' } }
        : { id: 'inputs', group: 'agent', label: 'Per-row inputs ({column})', status: 'pass', detail: ctx.summary.columns.map((c) => `{${c.column}}`).join(', ') });
  }

  // ── Contract ──
  const shape: string[] = [];
  if (fields[0]?.column_name !== (info?.idColumn ?? getFeedSchema(ctx.feedType).idColumn)) shape.push('the id must be the first field');
  if (fields.some((f) => !/^\$\.data\[\*\]\.[^.[\]\s]+$/.test(f.at))) shape.push('every "at" must be $.data[*].<flat key>');
  if ((String(document.service_value_format).match(/\{token\}/g) ?? []).length !== 1) shape.push('{token} must appear exactly once');
  const max = document.call_rules.max_ids_per_call;
  if (!(Number.isInteger(max) && max >= 1 && max <= 100)) shape.push('max_ids_per_call must be 1–100');
  if (/[{}]/.test(document.base_url + document.request.path)) shape.push('no placeholders in base_url or path');
  add(shape.length === 0
    ? { id: 'format', group: 'contract', label: 'Follows contract/1', status: 'pass', detail: `${fields.length} fields, max ${max} ids per call, ${document.service_header}: ${document.service_value_format}` }
    : { id: 'format', group: 'contract', label: 'Follows contract/1', status: 'fail', detail: shape.join('; '), fix: { place: 'design', text: 'Fix the design' } });

  add(baseUrlCheck(document.base_url));

  const sampleProblems = [...note('SAMPLE_FAILED'), ...note('SAMPLE_IDS_UNKNOWN')].map((n) => n.message);
  add(sampleProblems.length === 0
    ? { id: 'sample_ids', group: 'contract', label: 'Sample ids get an answer', status: 'pass', detail: p.sampleIds.join(', ') }
    : { id: 'sample_ids', group: 'contract', label: 'Sample ids get an answer', status: 'fail', detail: sampleProblems.join(' '), fix: { place: note('SAMPLE_FAILED').length ? 'design' : 'agent', text: note('SAMPLE_FAILED').length ? 'Fix the design' : "Pick sample ids from your data on the agent" } });

  // ── Token ──
  const t = agent.token;
  const tokenValue = t?.tokenEncrypted ? decryptToken(t.tokenEncrypted, t.tokenHash) : null;
  const state = t ? tokenState(t) : null;
  add(!t
    ? { id: 'token', group: 'token', label: "The agent's token works", status: 'fail', detail: 'No token linked. Link the token you pasted in Studio ("Agent access token") for this agent.', fix: { place: 'agent', text: 'Link a token' } }
    : state !== 'active'
      ? { id: 'token', group: 'token', label: "The agent's token works", status: 'fail', detail: `"${t.name}" is ${state}. ${state === 'expired' ? 'Extend it, or renew it and paste the new one in Studio.' : 'Make a new token, paste it in Studio and link it here.'}`, fix: { place: 'tokens', text: state === 'expired' ? 'Extend or renew the token' : 'Make a new token' } }
      : !tokenValue
        ? { id: 'token', group: 'token', label: "The agent's token works", status: 'warn', detail: `"${t.name}" works but can't be read here (saved with another encryption key), so the live call below can't run. Renew it and paste the new one in Studio.`, fix: { place: 'tokens', text: 'Renew the token' } }
        : { id: 'token', group: 'token', label: "The agent's token works", status: 'pass', detail: `"${t.name}" (${t.hint}…). It must be the token pasted in Studio for this agent.` });
  add(!info || info.serviceTokenRegistered === null
    ? { id: 'token_in_studio', group: 'token', label: 'A token is registered in Studio', status: 'skip', detail: 'Known once the agent is read from Jivox' }
    : info.serviceTokenRegistered
      ? { id: 'token_in_studio', group: 'token', label: 'A token is registered in Studio', status: 'pass', detail: 'Jivox has a token for this agent (it should be the one linked above)' }
      : { id: 'token_in_studio', group: 'token', label: 'A token is registered in Studio', status: 'fail', detail: 'Jivox has no token for this agent yet. In Studio: Real-time data → the agent → access keys → "Agent access token" → paste it → Save token.', fix: { place: 'studio', text: 'Paste the token in Studio' } });

  // ── Live call, like Jivox's verification ──
  const published = ctx.status === 'published';
  add(published
    ? { id: 'published', group: 'live', label: 'The API is published', status: 'pass', detail: 'Answers on /v1' }
    : { id: 'published', group: 'live', label: 'The API is published', status: 'fail', detail: 'Publish it: until then /v1 answers 404 and Jivox can\'t verify.', fix: { place: 'publish', text: 'Publish' } });
  let response: Awaited<ReturnType<typeof callLive>> | null = null;
  if (!published || !tokenValue || state !== 'active') {
    add({ id: 'live', group: 'live', label: "Jivox's verification call", status: 'skip', detail: `Not run: ${!published ? 'the API is a draft' : 'no usable token for this agent'}.` });
  } else {
    try {
      response = await callLive(p.sample, ctx.authHeader, tokenValue);
    } catch (err) {
      const why = err instanceof Error && err.name === 'TimeoutError' ? `no answer within ${LIVE_TIMEOUT_MS / 1000} s` : 'connection failed';
      add({ id: 'live', group: 'live', label: "Jivox's verification call", status: 'fail', detail: `${p.sample.url}: ${why}.`, fix: { place: 'settings', text: 'Check PUBLIC_BASE_URL and that the server runs' } });
    }
    if (response) {
      for (const c of liveChecks(document, p.sampleIds, fields, response)) add(c);
      const anonymous = await callLive(p.sample, ctx.authHeader, null).catch(() => null);
      const refused = anonymous?.status === 401;
      add({ id: 'needs_token', group: 'live', label: 'Refuses calls without the token', status: refused ? 'pass' : 'fail', detail: refused ? 'HTTP 401' : `HTTP ${anonymous?.status ?? 'no answer'}: calls without a token must be refused` });
    }
  }

  return {
    agent: { id: agent.id, name: agent.name },
    ready: checks.every((c) => c.status !== 'fail'),
    checks,
    document,
    sample: { ids: p.sampleIds, request: describeRequest(p.sample), response: response ? { status: response.status, body: response.body } : { status: p.answer.status, body: p.answer.body }, live: response !== null },
    designVersion: ctx.designVersion,
    // 5.6: the contract last copied / downloaded, and what changed since (not a check: a reminder).
    contract: p.contract,
  };
}

// What Jivox's verification checks on the answer, against THIS contract (its id path and its fields).
function liveChecks(document: { fields: unknown }, ids: string[], fields: DocField[], res: Awaited<ReturnType<typeof callLive>>): ContractCheck[] {
  const out: ContractCheck[] = [];
  const add = (id: string, label: string, ok: boolean, okDetail: string, bad: string, status: Status = 'fail') =>
    out.push({ id, group: 'live', label, status: ok ? 'pass' : status, detail: ok ? okDetail : bad });
  add('status_2xx', 'Answers with a 2xx status', res.status >= 200 && res.status < 300, `HTTP ${res.status}`, `HTTP ${res.status}${errorText(res.body)}`);
  const cache = res.headers['Cache-Control'] ?? '';
  add('no_store', 'Cache-Control: no-store', /\bno-store\b/i.test(cache), 'Sent', cache ? `Sent "${cache}"` : 'Header missing');
  const body = res.body as { status?: unknown; data?: unknown; errors?: unknown } | null;
  const ok = !!body && typeof body === 'object' && body.status === 'success' && Array.isArray(body.data);
  add('success', 'status "success" in the envelope', ok, '"success"', `Not a success envelope${errorText(res.body)}`);
  const idKey = keyOf(fields[0].at);
  const items = ok ? (body!.data as Record<string, unknown>[]).filter((d) => d && typeof d === 'object') : [];
  const idProblems = ids.flatMap((id) => {
    const n = items.filter((d) => d[idKey] === id).length;
    return n === 1 ? [] : [n === 0 ? `${id} is missing` : `${id} comes back ${n} times`];
  });
  add('ids_once', `Every sample id once at ${fields[0].at}`, ok && idProblems.length === 0, ids.join(', '), ok ? listed(idProblems) : 'No items');
  const bad: string[] = [];
  const noValue: string[] = [];
  for (const item of items) {
    for (const f of fields.slice(1)) {
      const key = keyOf(f.at);
      if (!(key in item)) {
        // Missing → Jivox uses default_value; "" = no value for that row (allowed, but worth knowing).
        if (f.default_value === '') noValue.push(`${item[idKey]}: no "${key}" (no default: no value shown)`);
        continue;
      }
      const type = (f.type ?? 'string') as FieldType;
      if (!matchesType(type, item[key])) bad.push(`${item[idKey]}: "${key}" is ${show(item[key])}, ${f.column_name} is ${type}`);
    }
  }
  add('fields_typed', "Every field of its type (or its default)", ok && bad.length === 0, `${fields.length - 1} field${fields.length === 2 ? '' : 's'} × ${items.length} item${items.length === 1 ? '' : 's'}`, ok ? `${listed(bad)}. Pick other sample ids, or set "leave the key out" / a Default for empty values on the Design tab.` : 'No items');
  if (noValue.length > 0) out.push({ id: 'no_value', group: 'live', label: 'Every sample row has a value', status: 'warn', detail: listed(noValue) });
  add('fast', `Answers within ${JIVOX_TIME_LIMIT_MS / 1000} s`, res.durationMs < JIVOX_TIME_LIMIT_MS, `${res.durationMs} ms`, `${res.durationMs} ms`);
  return out.map((c) => (c.id === 'fields_typed' && c.status === 'fail' ? { ...c, fix: { place: 'design' as const, text: 'Pick other sample ids or change empty-value handling' } } : c));
}

// Jivox (on qa3) calls the base URL from outside: it must be https and not this machine.
export function baseUrlCheck(baseUrl: string): ContractCheck {
  const base = new URL(baseUrl);
  const host = base.hostname;
  const local = ['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'].includes(host) || host.endsWith('.localhost');
  if (base.protocol === 'https:' && !local) return { id: 'base_url', group: 'contract', label: 'Jivox can reach the base URL', status: 'pass', detail: baseUrl };
  return {
    id: 'base_url',
    group: 'contract',
    label: 'Jivox can reach the base URL',
    status: 'fail',
    detail: local
      ? `${baseUrl}: Jivox on qa3 can't reach this machine. Set PUBLIC_BASE_URL to a public https address (a tunnel, or the deployed server).`
      : `${baseUrl}: Jivox needs an https address.`,
    fix: { place: 'settings', text: 'Set PUBLIC_BASE_URL (Phase 6.1: tunnel)' },
  };
}

