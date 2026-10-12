// SERVICE for writing to Jivox per agent (task 6.4): Submit, Versions (live), Activate, History.
//
// Submit  = the checklist (5.4) on the FRESH contract → with ✗: 409 CHECKLIST_FAILED unless "anyway"
//           (P6-3) → one action at a time per agent (6.3, 409 JIVOX_BUSY) → submit_contract → read
//           Jivox's answer loosely (jivox-answers.ts) → record it (scrubbed) → verified: the agent's
//           "last contract" becomes the submitted one (5.6 out of date compares with what Jivox has).
// Activate = activate_contract(version), recorded the same way.
// When Jivox can't be reached, times out or refuses the key, the action is recorded as an error and
// the answer is still 200 { action } (the action ran; its record says what happened). Errors BEFORE
// anything is sent (not connected, busy, checklist, host not allowed) are 4xx and record nothing.
// The access key is used only in the client's Authorization header and scrubbed from everything kept.
import type { Api } from '../../../generated/prisma/client.js';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/app-error.js';
import { createJivoxMcpClient, JivoxMcpError } from '../../../lib/jivox-mcp.js';
import { prisma } from '../../../lib/prisma.js';
import { openSecret } from '../../../lib/secret-box.js';
import { bindKey, findAgent, mcpFailure } from './agents.service.js';
import { checkAgentContract } from './contract-check.js';
import { contractShape } from './contract-shape.js';
import { readActivate, readSubmit, readVersions } from './jivox-answers.js';
import { type ErrorOutcome, failAction, finishAction, getAction, listActions, startAction } from './jivox-actions.js';

type ActionRow = NonNullable<Awaited<ReturnType<typeof getAction>>>;

// The agent's MCP destination, its key, and a client. `write`: the host must be allowed to receive writes.
async function connect(api: Api, agentId: string, write: boolean) {
  const agent = await findAgent(prisma, api, agentId);
  if (!agent.mcpUrl || !agent.accessKeyEncrypted) {
    throw new AppError(409, 'AGENT_NOT_CONNECTED', 'Add the MCP destination and access key from Studio first (Real-time data → the agent → access keys).');
  }
  const key = openSecret(agent.accessKeyEncrypted, bindKey(agent.id));
  if (!key) throw new AppError(409, 'ACCESS_KEY_UNREADABLE', "The saved access key can't be read (it was saved with another encryption key). Paste it again.");
  const host = new URL(agent.mcpUrl).host;
  if (write && !writeAllowed(host)) {
    throw new AppError(403, 'JIVOX_WRITE_HOST_NOT_ALLOWED', `This server may not submit or activate on ${host} (JIVOX_WRITE_HOSTS). Reading still works.`);
  }
  return { agent, key, host, client: createJivoxMcpClient(agent.mcpUrl, key) };
}

export function writeAllowed(host: string, setting = env.JIVOX_WRITE_HOSTS) {
  if (!setting) return true; // P6-2: any host (the confirmation dialog names it)
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  return setting.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean).some((h) => h === '*' || h === hostname || h === host.toLowerCase());
}

const ERROR_OUTCOME: Record<JivoxMcpError['kind'], ErrorOutcome> = { unreachable: 'unreachable', timeout: 'timeout', auth: 'auth_failed', protocol: 'bad_answer', tool: 'bad_answer' };
const TIMEOUT_NOTE = ' Jivox may still finish it: check the versions in a minute.';

// What the browser sees of an action: the record + Jivox's answer read again (so the history shows the
// same explanation as the moment it happened). Light rows (history) have no answer / document.
export function presentAction(row: Partial<ActionRow> & { id: string; kind: string; startedBy?: { email: string } | null }) {
  const answer = row.answer as unknown;
  const reading = answer === undefined || answer === null ? null : row.kind === 'submit' ? readSubmit(answer) : readActivate(answer, row.version ?? 0);
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    outcome: row.outcome,
    jivoxStatus: row.jivoxStatus ?? null,
    version: row.version ?? null,
    mcpHost: row.mcpHost,
    designVersion: row.designVersion ?? null,
    failedChecks: row.failedChecks ?? [],
    errorMessage: row.errorMessage ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    startedBy: row.startedBy?.email ?? null,
    ...(reading && {
      message: reading.message,
      problems: reading.problems,
      hints: reading.hints,
      evidence: reading.evidence,
      ...('retired' in reading && { retired: reading.retired }),
    }),
    ...(answer !== undefined && { answer: answer ?? null }),
    ...(row.document !== undefined && { document: row.document }),
  };
}

const withUser = (id: string) => prisma.jivoxContractAction.findUnique({ where: { id }, include: { startedBy: { select: { email: true } } } });

// POST …/jivox/submit { anyway? }
export async function submitToJivox(api: Api, brandSlug: string, agentId: string, userId: string, anyway: boolean) {
  const { agent, key, host, client } = await connect(api, agentId, true);
  const check = await checkAgentContract(api, brandSlug, agentId); // the FRESH contract + its checklist
  const failed = check.checks.filter((c) => c.status === 'fail');
  if (failed.length > 0 && !anyway) {
    throw new AppError(409, 'CHECKLIST_FAILED', `${failed.length} check${failed.length === 1 ? '' : 's'} to fix first (or submit anyway to see how Jivox answers).`, {
      extra: { failed: failed.map((c) => ({ id: c.id, label: c.label, detail: c.detail })) },
    });
  }
  const document = check.document as Record<string, unknown>;
  const action = await startAction({
    agentId: agent.id,
    kind: 'submit',
    mcpHost: host,
    document,
    designVersion: check.designVersion,
    failedChecks: failed.map((c) => c.id),
    startedById: userId,
  });
  let finished;
  try {
    const { isError, value } = await client.callWrite('submit_contract', { contract: document });
    const reading = readSubmit(value);
    if (isError && reading.outcome === 'unknown') {
      // Jivox said "error" in words we can't read as a contract result: a bad answer, its text kept.
      finished = await failAction(action.id, { outcome: 'bad_answer', message: `Jivox answered with an error: ${typeof value === 'string' ? value : JSON.stringify(value)}` }, [key]);
    } else {
      finished = await finishAction(action.id, { outcome: reading.outcome, jivoxStatus: reading.jivoxStatus, version: reading.version, answer: value }, [key]);
      if (finished && reading.outcome === 'verified') {
        // 5.6: from now on "out of date" compares with what Jivox holds.
        await prisma.jivoxAgent.updateMany({
          where: { id: agent.id },
          data: { lastContractAt: new Date(), lastContractHow: 'submit', lastContractDesignVersion: check.designVersion, lastContractShape: contractShape(document) as object },
        });
      }
    }
  } catch (err) {
    if (!(err instanceof JivoxMcpError)) {
      await failAction(action.id, { outcome: 'bad_answer', message: 'Something went wrong on our side while sending; nothing is known about Jivox.' }).catch(() => undefined);
      throw err;
    }
    finished = await failAction(action.id, { outcome: ERROR_OUTCOME[err.kind], message: err.message + (err.kind === 'timeout' ? TIMEOUT_NOTE : '') }, [key]);
  }
  return { action: presentAction((await withUser(finished?.id ?? action.id))!) };
}

// POST …/jivox/versions/:version/activate
export async function activateOnJivox(api: Api, agentId: string, userId: string, version: number) {
  const { agent, key, host, client } = await connect(api, agentId, true);
  const action = await startAction({ agentId: agent.id, kind: 'activate', mcpHost: host, version, startedById: userId });
  let finished;
  try {
    const { isError, value } = await client.callWrite('activate_contract', { version });
    const reading = readActivate(value, version);
    if (isError && reading.outcome === 'unknown') {
      finished = await failAction(action.id, { outcome: 'bad_answer', message: `Jivox answered with an error: ${typeof value === 'string' ? value : JSON.stringify(value)}` }, [key]);
    } else {
      finished = await finishAction(action.id, { outcome: reading.outcome, jivoxStatus: reading.jivoxStatus, version, answer: value }, [key]);
    }
  } catch (err) {
    if (!(err instanceof JivoxMcpError)) {
      await failAction(action.id, { outcome: 'bad_answer', message: 'Something went wrong on our side while sending; nothing is known about Jivox.' }).catch(() => undefined);
      throw err;
    }
    finished = await failAction(action.id, { outcome: ERROR_OUTCOME[err.kind], message: err.message + (err.kind === 'timeout' ? TIMEOUT_NOTE : '') }, [key]);
  }
  return { action: presentAction((await withUser(finished?.id ?? action.id))!) };
}

// GET …/jivox/versions: live from Jivox (read-only), plus what WE know of each version.
export async function jivoxVersions(api: Api, agentId: string) {
  const { agent, client } = await connect(api, agentId, false);
  let list;
  try {
    list = readVersions(await client.callReadOnly('list_contracts'));
  } catch (err) {
    if (err instanceof JivoxMcpError) throw mcpFailure(err);
    throw err;
  }
  const ours = await prisma.jivoxContractAction.findMany({
    where: { agentId: agent.id, kind: 'submit', outcome: 'verified', version: { in: list.versions.map((v) => v.version) } },
    select: { id: true, version: true, designVersion: true, startedAt: true, startedBy: { select: { email: true } } },
    orderBy: { startedAt: 'desc' },
  });
  const running = await prisma.jivoxContractAction.findFirst({ where: { agentId: agent.id, state: 'running' }, select: { kind: true, version: true, startedAt: true } });
  return {
    activeVersion: list.activeVersion,
    versions: list.versions.map((v) => {
      const mine = ours.find((o) => o.version === v.version);
      return { ...v, submittedHere: mine ? { actionId: mine.id, designVersion: mine.designVersion, at: mine.startedAt, by: mine.startedBy?.email ?? null } : null };
    }),
    running,
  };
}

// GET …/jivox/actions?before=&limit= and …/jivox/actions/:actionId
export async function jivoxHistory(api: Api, agentId: string, opts: { before?: string; limit?: number }) {
  const agent = await findAgent(prisma, api, agentId);
  const page = await listActions(agent.id, opts);
  return { actions: page.actions.map((a) => presentAction(a)), next: page.next };
}

export async function jivoxActionDetail(api: Api, agentId: string, actionId: string) {
  const agent = await findAgent(prisma, api, agentId);
  const row = await prisma.jivoxContractAction.findFirst({ where: { id: actionId, agentId: agent.id }, include: { startedBy: { select: { email: true } } } });
  if (!row) throw new AppError(404, 'ACTION_NOT_FOUND', 'No such submit / activate for this agent');
  return { action: presentAction(row) };
}
