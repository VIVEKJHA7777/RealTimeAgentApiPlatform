// CONTROLLER for an API's Jivox agents (Phase 5, task 5.2): HTTP in/out only. Every answer is
// `no-store`. The access key is write-only: it is never in an answer, and the request logger logs
// no bodies.
import type { Request, Response } from 'express';
import { validate } from '../../../lib/validate.js';
import { contractTakenSchema, createAgentSchema, historyQuery, submitSchema, updateAgentSchema, versionParam } from './agents.schemas.js';
import * as jivoxWrites from './jivox-writes.service.js';
import * as agentsService from './agents.service.js';
import { checkAgentContract } from './contract-check.js';
import { contractFileName, generateAgentContract } from './contract.js';

const agentId = (req: Request) => String(req.params.agentId);
const brand = (req: Request) => req.organization!.slug;

// GET …/apis/:apiSlug/agents → 200 { agents: [agent], limits: { maxAgents } }
export async function list(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await agentsService.listAgents(req.api!, brand(req)));
}

// POST …/agents { name, brandstore?, fields?, tokenId?, mcpUrl?, accessKey?, sampleIds? } → 201 { agent }
// · 400 VALIDATION_ERROR · 409 AGENT_NAME_TAKEN / TOO_MANY_AGENTS / TOKEN_REVOKED
export async function create(req: Request, res: Response) {
  const input = validate(createAgentSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.status(201).json(await agentsService.createAgent(req.api!, brand(req), input));
}

// GET …/agents/:agentId → 200 { agent } · 404
export async function getOne(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await agentsService.getAgent(req.api!, brand(req), agentId(req)));
}

// PATCH …/agents/:agentId { any of the create fields; accessKey: new one or null to remove } → 200 { agent }
// · 400 · 404 · 409 AGENT_NAME_TAKEN / TOKEN_REVOKED
export async function update(req: Request, res: Response) {
  const input = validate(updateAgentSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.json(await agentsService.updateAgent(req.api!, brand(req), agentId(req), input));
}

// DELETE …/agents/:agentId → 204 · 404
export async function remove(req: Request, res: Response) {
  await agentsService.deleteAgent(req.api!, agentId(req));
  res.status(204).end();
}

// POST …/agents/:agentId/read-jivox → 200 { agent, fieldsBefore, feedTypeMatches }
// · 404 · 409 AGENT_NOT_CONNECTED / ACCESS_KEY_UNREADABLE / AGENT_CHANGED
// · 422 JIVOX_AUTH_FAILED · 502 JIVOX_UNREACHABLE / JIVOX_BAD_ANSWER
export async function readJivox(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await agentsService.readFromJivox(req.api!, brand(req), agentId(req)));
}

// GET …/agents/:agentId/contract → 200 { agent, document, notes, sample: { ids, request, response },
// apiStatus, designVersion } (task 5.3) · 404 · 409 NO_DESIGN / NO_DATA / DESIGN_INVALID
export async function contract(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await generateAgentContract(req.api!, req.organization!.slug, agentId(req)));
}

// GET …/agents/:agentId/contract/download → the document alone, as contract-<api>-<agent>.json
export async function downloadContract(req: Request, res: Response) {
  const { agent, document } = await generateAgentContract(req.api!, req.organization!.slug, agentId(req));
  res.set('Cache-Control', 'no-store');
  res.attachment(contractFileName(req.api!.slug, agent.name));
  res.type('application/json').send(JSON.stringify(document, null, 2) + '\n');
}

// POST …/agents/:agentId/contract/check → 200 { agent, ready, checks: [{ id, group, label, status,
// detail, fix? }], document, sample } (task 5.4). POST: it makes a live call to our own /v1.
export async function checkContract(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await checkAgentContract(req.api!, req.organization!.slug, agentId(req)));
}

// POST …/agents/:agentId/contract/taken { how: copy | download, designVersion, document } → 200 { agent }
// (task 5.6) · 400 · 404. Remembers the contract's shape so the agent can say "out of date" later.
export async function contractTaken(req: Request, res: Response) {
  const input = validate(contractTakenSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.json(await agentsService.markContractTaken(req.api!, brand(req), agentId(req), input));
}

// ── Phase 6 (task 6.4): Submit / Versions / Activate / History, per agent ──

// POST …/agents/:agentId/jivox/submit { anyway?: boolean } → 200 { action } (also when Jivox couldn't be
// reached: the action says so) · 409 AGENT_NOT_CONNECTED / ACCESS_KEY_UNREADABLE / CHECKLIST_FAILED
// (extra.failed) / JIVOX_BUSY (extra.running) / NO_DESIGN / NO_DATA · 403 JIVOX_WRITE_HOST_NOT_ALLOWED · 413
export async function submit(req: Request, res: Response) {
  const input = validate(submitSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.json(await jivoxWrites.submitToJivox(req.api!, brand(req), agentId(req), req.user!.id, input.anyway));
}

// GET …/agents/:agentId/jivox/versions → 200 { activeVersion, versions: [{ version, status, active,
// createdAt, submittedHere, extra }], running } · 422 JIVOX_AUTH_FAILED · 502 JIVOX_UNREACHABLE / JIVOX_BAD_ANSWER
export async function versions(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await jivoxWrites.jivoxVersions(req.api!, agentId(req)));
}

// POST …/agents/:agentId/jivox/versions/:version/activate → 200 { action } · 400 · 409 · 403
export async function activate(req: Request, res: Response) {
  const version = validate(versionParam, req.params.version);
  res.set('Cache-Control', 'no-store');
  res.json(await jivoxWrites.activateOnJivox(req.api!, agentId(req), req.user!.id, version));
}

// GET …/agents/:agentId/jivox/actions?before=&limit= → 200 { actions (light), next }
export async function history(req: Request, res: Response) {
  const q = validate(historyQuery, req.query);
  res.set('Cache-Control', 'no-store');
  res.json(await jivoxWrites.jivoxHistory(req.api!, agentId(req), q));
}

// GET …/agents/:agentId/jivox/actions/:actionId → 200 { action } with the document sent + Jivox's answer · 404
export async function actionDetail(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await jivoxWrites.jivoxActionDetail(req.api!, agentId(req), String(req.params.actionId)));
}
