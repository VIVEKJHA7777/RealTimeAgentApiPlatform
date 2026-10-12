// OUR record of every Submit / Activate sent to Jivox for an agent (task 6.3). Jivox stays the source
// of truth for versions and which one is active; this keeps what we sent, where, by whom, and what
// Jivox answered, so the agent panel can show a history and explain each result.
//
//   startAction  → a `running` row. The database allows ONE per agent (partial unique index): a double
//                  click, two tabs or two people get 409 JIVOX_BUSY. A running row older than
//                  STALE_AFTER_MS (a restart cut the call off) is marked `interrupted` and replaced.
//   finishAction → `done`: Jivox answered (verified / failed / invalid / gate_failed / activated / refused / unknown)
//   failAction   → `error`: it didn't (unreachable / auth_failed / bad_answer / timeout)
//   interruptRunningOnBoot → at start-up every running row is from a process that died (ONE server;
//                  Phase 8 with several servers must scope this to its own rows)
// What we store is scrubbed: token-shaped text and the agent's access key never land in the table.
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppError } from '../../../lib/app-error.js';
import { scrubTokens } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { isUniqueViolation } from '../../../lib/prisma-errors.js';

export const STALE_AFTER_MS = 3 * 60_000; // a submit waits ≤ 60 s for Jivox; 3 min = surely dead
export const MAX_ANSWER_BYTES = 64 * 1024;
export const MAX_DOCUMENT_BYTES = 256 * 1024;
const ONE_RUNNING = 'jivox_contract_actions_one_running';

export type ActionKind = 'submit' | 'activate';
export type DoneOutcome = 'verified' | 'failed' | 'invalid' | 'gate_failed' | 'activated' | 'refused' | 'unknown';
export type ErrorOutcome = 'unreachable' | 'auth_failed' | 'bad_answer' | 'timeout';

// ── Scrubbing (pure) ──
// Token-shaped text (rtk_…), the given secrets (the agent's access key) and credential-like keys are
// replaced at every depth. Then capped: a bigger answer is kept as a scrubbed text preview.
const SECRET_KEYS = /^(authorization|x-api-key|cookie|set-cookie|token|access_key|accesskey|api_key|apikey)$/i;
export function scrubValue(value: unknown, secrets: string[]): unknown {
  const real = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
  const text = (s: string) => real.reduce((t, secret) => t.split(secret).join('[Redacted]'), scrubTokens(s));
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [text(k), SECRET_KEYS.test(k) && x != null ? '[Redacted]' : walk(x)]));
    }
    return v;
  };
  return walk(value);
}

export function storableAnswer(value: unknown, secrets: string[]): Prisma.InputJsonValue {
  const clean = scrubValue(value === undefined ? null : value, secrets);
  const json = JSON.stringify(clean) ?? 'null';
  if (Buffer.byteLength(json) <= MAX_ANSWER_BYTES - 1024) return (clean ?? { value: null }) as Prisma.InputJsonValue;
  // Too big to keep whole: a preview (cut on characters, so no half-encoded text), marked as such.
  let preview = json.slice(0, 60_000);
  while (Buffer.byteLength(preview) > 60_000) preview = preview.slice(0, Math.floor(preview.length * 0.9));
  return { truncated: true, bytes: Buffer.byteLength(json), preview };
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── Writing ──
type StartInput = {
  agentId: string;
  kind: ActionKind;
  mcpHost: string;
  startedById?: string | null;
  version?: number; // activate: the target
  document?: Record<string, unknown>; // submit: exactly what is sent
  designVersion?: number;
  failedChecks?: string[]; // submit "anyway": the ✗ at the time
};

export async function startAction(input: StartInput) {
  if (input.kind === 'submit' && Buffer.byteLength(JSON.stringify(input.document ?? null)) > MAX_DOCUMENT_BYTES) {
    throw new AppError(413, 'CONTRACT_TOO_BIG', 'This contract is bigger than 256 KB. Use fewer or shorter sample items (sample ids).');
  }
  const data = {
    agentId: input.agentId,
    kind: input.kind,
    mcpHost: short(input.mcpHost, 255),
    startedById: input.startedById ?? null,
    version: input.version ?? null,
    document: input.document as Prisma.InputJsonValue | undefined,
    designVersion: input.designVersion ?? null,
    failedChecks: (input.failedChecks ?? []).slice(0, 50),
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.jivoxContractAction.create({ data });
    } catch (err) {
      if (!isUniqueViolation(err, ONE_RUNNING) || attempt > 0) {
        if (isUniqueViolation(err, ONE_RUNNING)) throw busy(await runningOf(input.agentId));
        throw err;
      }
      // Someone's action is running for this agent. Dead (a restart cut it off)? Mark it and retry once.
      const running = await runningOf(input.agentId);
      if (running && Date.now() - running.startedAt.getTime() < STALE_AFTER_MS) throw busy(running);
      if (running) await markInterrupted({ id: running.id });
    }
  }
}

const runningOf = (agentId: string) => prisma.jivoxContractAction.findFirst({ where: { agentId, state: 'running' } });

function busy(running: { kind: string; startedAt: Date; version: number | null } | null) {
  const what = running?.kind === 'activate' ? `Activating version ${running.version}` : 'A submit';
  const ago = running ? Math.max(1, Math.round((Date.now() - running.startedAt.getTime()) / 1000)) : 0;
  return new AppError(409, 'JIVOX_BUSY', `${what} for this agent is still running${running ? ` (started ${ago} s ago)` : ''}. Wait for it to finish.`, {
    extra: running ? { running: { kind: running.kind, startedAt: running.startedAt, version: running.version } } : undefined,
  });
}

// Only a row that is still `running` is finished (one marked interrupted meanwhile stays so) → null then.
export async function finishAction(id: string, result: { outcome: DoneOutcome; jivoxStatus?: string | null; version?: number | null; answer: unknown }, secrets: string[] = []) {
  const { count } = await prisma.jivoxContractAction.updateMany({
    where: { id, state: 'running' },
    data: {
      state: 'done',
      outcome: result.outcome,
      jivoxStatus: result.jivoxStatus ? short(String(result.jivoxStatus), 50) : null,
      ...(result.version != null && { version: result.version }),
      answer: storableAnswer(result.answer, secrets),
      finishedAt: new Date(),
    },
  });
  return count === 1 ? prisma.jivoxContractAction.findUnique({ where: { id } }) : null;
}

export async function failAction(id: string, result: { outcome: ErrorOutcome; message: string }, secrets: string[] = []) {
  const { count } = await prisma.jivoxContractAction.updateMany({
    where: { id, state: 'running' },
    data: { state: 'error', outcome: result.outcome, errorMessage: short(String(scrubValue(result.message, secrets)), 1000), finishedAt: new Date() },
  });
  return count === 1 ? prisma.jivoxContractAction.findUnique({ where: { id } }) : null;
}

async function markInterrupted(where: Prisma.JivoxContractActionWhereInput) {
  const { count } = await prisma.jivoxContractAction.updateMany({
    where: { ...where, state: 'running' },
    data: { state: 'error', outcome: 'interrupted', errorMessage: 'Interrupted: the server restarted (or stopped waiting) before Jivox answered. Check the versions list: Jivox may have finished it.', finishedAt: new Date() },
  });
  return count;
}

// At start-up: every running row belongs to a process that's gone (this app runs as ONE server).
export const interruptRunningOnBoot = () => markInterrupted({});

// ── Reading ──
// An agent's history, newest first, in pages (cursor = the last row's id). Light rows by default
// (no document / answer); `full` for one row's details.
export async function listActions(agentId: string, opts: { limit?: number; before?: string } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const rows = await prisma.jivoxContractAction.findMany({
    where: { agentId },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.before && { cursor: { id: opts.before }, skip: 1 }),
    select: {
      id: true, kind: true, state: true, outcome: true, jivoxStatus: true, version: true, mcpHost: true, designVersion: true,
      failedChecks: true, errorMessage: true, startedAt: true, finishedAt: true, startedBy: { select: { email: true } },
    },
  });
  return { actions: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].id : null };
}

export const getAction = (agentId: string, id: string) => prisma.jivoxContractAction.findFirst({ where: { id, agentId } });

// For the agents table (6.5): per agent, as WE last saw it (one query each, all agents at once).
export async function jivoxSummaries(agentIds: string[]) {
  if (agentIds.length === 0) return new Map<string, JivoxSummary>();
  const [activated, submits, running] = await Promise.all([
    prisma.$queryRaw<{ agent_id: string; version: number; started_at: Date }[]>`
      SELECT DISTINCT ON (agent_id) agent_id, version, started_at FROM jivox_contract_actions
      WHERE agent_id = ANY(${agentIds}) AND outcome = 'activated' ORDER BY agent_id, started_at DESC`,
    prisma.$queryRaw<{ agent_id: string; outcome: string | null; version: number | null; state: string; started_at: Date }[]>`
      SELECT DISTINCT ON (agent_id) agent_id, outcome, version, state, started_at FROM jivox_contract_actions
      WHERE agent_id = ANY(${agentIds}) AND kind = 'submit' AND state <> 'running' ORDER BY agent_id, started_at DESC`,
    prisma.jivoxContractAction.findMany({ where: { agentId: { in: agentIds }, state: 'running' }, select: { agentId: true, kind: true, version: true, startedAt: true } }),
  ]);
  const out = new Map<string, JivoxSummary>();
  for (const id of agentIds) {
    const a = activated.find((x) => x.agent_id === id);
    const s = submits.find((x) => x.agent_id === id);
    const r = running.find((x) => x.agentId === id);
    out.set(id, {
      activeVersion: a?.version ?? null,
      activatedAt: a?.started_at ?? null,
      lastSubmit: s ? { outcome: s.outcome, version: s.version, at: s.started_at } : null,
      running: r ? { kind: r.kind, version: r.version, startedAt: r.startedAt } : null,
    });
  }
  return out;
}
export type JivoxSummary = {
  activeVersion: number | null;
  activatedAt: Date | null;
  lastSubmit: { outcome: string | null; version: number | null; at: Date } | null;
  running: { kind: string; version: number | null; startedAt: Date } | null;
};
