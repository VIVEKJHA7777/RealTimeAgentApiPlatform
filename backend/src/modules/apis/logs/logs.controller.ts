// CONTROLLER for an API's call log (Phase 7, task 7.3): HTTP in/out only.
import type { Request, Response } from 'express';
import { validate } from '../../../lib/validate.js';
import { logIdParam, logsQuery } from './logs.schemas.js';
import * as logs from './logs.service.js';

// GET …/apis/:apiSlug/logs?status=&token=&switched=&check=&id=&kind=&from=&to=&before=|after=&limit=
//   → 200 { entries (newest first, list lines), next, gap, matching, total, kept: 500, newestId, tokens } · 400
export async function list(req: Request, res: Response) {
  const q = validate(logsQuery, req.query);
  res.set('Cache-Control', 'no-store');
  res.json(await logs.listLogs(req.api!, q));
}

// GET …/apis/:apiSlug/logs/:logId → 200 { entry (everything), tokens, curl, curlNotes } · 404 LOG_NOT_FOUND
export async function getOne(req: Request, res: Response) {
  const logId = validate(logIdParam, req.params.logId);
  res.set('Cache-Control', 'no-store');
  res.json(await logs.getLog(req.api!, logId));
}

// DELETE …/apis/:apiSlug/logs → 200 { cleared, clearedAt } (calls only; switch lines stay)
export async function clear(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await logs.clearLogs(req.api!));
}
