// ROUTES layer for APIs (mounted at /api/organizations/:slug/apis).
import { Router } from 'express';
import { requireApi } from '../../middleware/require-api.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { requireOrganization } from '../../middleware/require-organization.js';
import * as agentsController from './agents/agents.controller.js';
import * as apisController from './apis.controller.js';
import * as designController from './design/design.controller.js';
import * as logsController from './logs/logs.controller.js';
import * as switchesController from './switches/switches.controller.js';
import * as testingController from './testing/testing.controller.js';
import * as tokensController from './tokens/tokens.controller.js';

// mergeParams: lets requireOrganization see :slug from the mount path.
export const apisRouter = Router({ mergeParams: true });

// Logged in AND owner of this brand, for every API route.
apisRouter.use(requireAuth, requireOrganization);

apisRouter.get('/', apisController.list);
apisRouter.post('/', apisController.create);
apisRouter.get('/:apiSlug', requireApi, apisController.getOne);
apisRouter.patch('/:apiSlug', requireApi, apisController.update);
apisRouter.delete('/:apiSlug', requireApi, apisController.remove);

// Phase 3: what the API sends (response design).
apisRouter.get('/:apiSlug/design', requireApi, designController.get);
apisRouter.put('/:apiSlug/design', requireApi, designController.save);
// Task 3.3: what the data's values look like (type suggestions, "can't convert" counts).
apisRouter.get('/:apiSlug/design/columns', requireApi, designController.columns);
apisRouter.post('/:apiSlug/design/check-values', requireApi, designController.checkValues);
// Task 3.5: example request + the real answer for a design (nothing saved).
apisRouter.post('/:apiSlug/design/preview', requireApi, designController.preview);

// Phase 4 (task 4.2): the API's tokens (what Jivox sends to /v1) and how it sends them.
apisRouter.get('/:apiSlug/tokens', requireApi, tokensController.list);
apisRouter.post('/:apiSlug/tokens', requireApi, tokensController.create);
apisRouter.get('/:apiSlug/tokens/:tokenId/reveal', requireApi, tokensController.reveal);
apisRouter.patch('/:apiSlug/tokens/:tokenId', requireApi, tokensController.update);
apisRouter.post('/:apiSlug/tokens/:tokenId/renew', requireApi, tokensController.renew);
apisRouter.delete('/:apiSlug/tokens/:tokenId', requireApi, tokensController.revoke);
apisRouter.put('/:apiSlug/auth-header', requireApi, tokensController.setAuthHeader);

// Task 4.4: publish / unpublish (only published APIs answer on /v1).
apisRouter.get('/:apiSlug/publish-check', requireApi, apisController.publishCheck);
apisRouter.post('/:apiSlug/publish', requireApi, apisController.publish);
apisRouter.post('/:apiSlug/unpublish', requireApi, apisController.unpublish);

// Task 4.5: the Test tab: "Try it" (in-app, any status) and the self-check (Jivox's checks).
apisRouter.post('/:apiSlug/try', requireApi, testingController.tryIt);
apisRouter.post('/:apiSlug/self-check', requireApi, testingController.selfCheck);
// Task 4.8b: the last 5 calls to the live URL (and Clear).
apisRouter.get('/:apiSlug/recent-calls', requireApi, testingController.recentCalls);
apisRouter.delete('/:apiSlug/recent-calls', requireApi, testingController.clearCalls);
// Phase 7 (task 7.3): the call log (every /v1 call, newest 500): list + filters, one entry + curl, Clear.
apisRouter.get('/:apiSlug/logs', requireApi, logsController.list);
apisRouter.get('/:apiSlug/logs/:logId', requireApi, logsController.getOne);
apisRouter.delete('/:apiSlug/logs', requireApi, logsController.clear);
// Task 7.4: test switches (/v1 answers wrongly on purpose, one mistake per switch; they end by themselves).
apisRouter.get('/:apiSlug/switches', requireApi, switchesController.list);
apisRouter.put('/:apiSlug/switches/:kind', requireApi, switchesController.set);
apisRouter.delete('/:apiSlug/switches/:kind', requireApi, switchesController.turnOff);
apisRouter.delete('/:apiSlug/switches', requireApi, switchesController.turnOff);

// Phase 5 (task 5.2): the Jivox Real Time Agents this API serves (many per API), and the read-only
// "Read from Jivox" (feed type, id column, bound fields, live tiers, contracts).
apisRouter.get('/:apiSlug/agents', requireApi, agentsController.list);
apisRouter.post('/:apiSlug/agents', requireApi, agentsController.create);
apisRouter.get('/:apiSlug/agents/:agentId', requireApi, agentsController.getOne);
apisRouter.patch('/:apiSlug/agents/:agentId', requireApi, agentsController.update);
apisRouter.delete('/:apiSlug/agents/:agentId', requireApi, agentsController.remove);
apisRouter.post('/:apiSlug/agents/:agentId/read-jivox', requireApi, agentsController.readJivox);
// Task 5.3: each agent's contract/1 document (generated from the design, never edited by hand).
apisRouter.get('/:apiSlug/agents/:agentId/contract', requireApi, agentsController.contract);
apisRouter.get('/:apiSlug/agents/:agentId/contract/download', requireApi, agentsController.downloadContract);
// Task 5.4: the checklist (every Jivox rule + a verification-like live call with the agent's token).
apisRouter.post('/:apiSlug/agents/:agentId/contract/check', requireApi, agentsController.checkContract);
// Task 5.6: the contract the user copied / downloaded (its shape), for "out of date".
apisRouter.post('/:apiSlug/agents/:agentId/contract/taken', requireApi, agentsController.contractTaken);
// Phase 6 (task 6.4): write to Jivox per agent (submit / activate), its versions (live) and our history.
apisRouter.post('/:apiSlug/agents/:agentId/jivox/submit', requireApi, agentsController.submit);
apisRouter.get('/:apiSlug/agents/:agentId/jivox/versions', requireApi, agentsController.versions);
apisRouter.post('/:apiSlug/agents/:agentId/jivox/versions/:version/activate', requireApi, agentsController.activate);
apisRouter.get('/:apiSlug/agents/:agentId/jivox/actions', requireApi, agentsController.history);
apisRouter.get('/:apiSlug/agents/:agentId/jivox/actions/:actionId', requireApi, agentsController.actionDetail);

