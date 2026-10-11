// CONTROLLER for the Test tab's backend (task 4.5): HTTP in/out only.
import type { Request, Response } from 'express';
import { validate } from '../../../lib/validate.js';
import { clearRecentCalls, listRecentCalls } from '../../v1/recent-calls.js';
import { testInputSchema } from './testing.schemas.js';
import * as testing from './testing.service.js';

// POST …/apis/:apiSlug/try { ids? } → 200 { mode: "in-app", status, designVersion, ids, request, curl,
// response: { status, headers, body }, durationMs }. The answer /v1 would give (also a failure
// envelope, e.g. TOO_MANY_IDS); no token; drafts too. · 409 NO_DESIGN / NO_DATA / DESIGN_INVALID
export async function tryIt(req: Request, res: Response) {
  const input = validate(testInputSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.json(await testing.tryApi(req.api!, req.organization!.slug, input));
}

// POST …/apis/:apiSlug/self-check { ids? } → 200 { mode: "live" | "in-app", url, ids, passed,
// checks: [{ id, label, status: pass|fail|warn|skip, detail }], request, response, durationMs }
export async function selfCheck(req: Request, res: Response) {
  const input = validate(testInputSchema, req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.json(await testing.selfCheck(req.api!, req.organization!.slug, input));
}

// GET …/apis/:apiSlug/recent-calls → 200 { calls: RecentCall[] (newest first, ≤ 5), kept: 5, clearedAt }
// (task 4.8b: the last calls to the live URL, by Jivox or anyone; self-checks aren't recorded)
export async function recentCalls(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await listRecentCalls(req.api!.id));
}

// DELETE …/apis/:apiSlug/recent-calls → 200 { calls: [], kept, clearedAt } · 404
export async function clearCalls(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await clearRecentCalls(req.api!.id));
}
