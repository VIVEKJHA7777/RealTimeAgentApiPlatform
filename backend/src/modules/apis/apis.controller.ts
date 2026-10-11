// CONTROLLER layer for APIs: HTTP in/out only.
import type { Request, Response } from 'express';
import { validate } from '../../lib/validate.js';
import { createApiSchema, updateApiSchema } from './apis.schemas.js';
import * as apisService from './apis.service.js';
import * as publishService from './publish.service.js';

// POST /api/organizations/:slug/apis   { name, slug, feedType?, dataSourceId }  → 201 { api }
export async function create(req: Request, res: Response) {
  const input = validate(createApiSchema, req.body ?? {});
  const { id, slug } = req.organization!;
  res.status(201).json({ api: await apisService.createApi(id, slug, input) });
}

// GET /api/organizations/:slug/apis   → 200 { apis }  (newest first)
export async function list(req: Request, res: Response) {
  const { id, slug } = req.organization!;
  res.set('Cache-Control', 'no-store'); // row counts / status change
  res.json({ apis: await apisService.listApis(id, slug) });
}

// GET /api/organizations/:slug/apis/:apiSlug   → 200 { api }
export async function getOne(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json({ api: await apisService.getApi(req.api!, req.organization!.slug) });
}

// PATCH /api/organizations/:slug/apis/:apiSlug   { name?, slug?, feedType?, dataSourceId? }
// → 200 { api, warnings }   (warnings: what to redo in Jivox when a published API changed)
export async function update(req: Request, res: Response) {
  const input = validate(updateApiSchema, req.body ?? {});
  res.json(await apisService.updateApi(req.api!, req.organization!.slug, input));
}

// DELETE /api/organizations/:slug/apis/:apiSlug   → 204 (its data source is kept)
export async function remove(req: Request, res: Response) {
  await apisService.deleteApi(req.api!);
  res.status(204).end();
}

// ── Publishing (Phase 4, task 4.4) ──

// GET /api/organizations/:slug/apis/:apiSlug/publish-check
// → 200 { status, publishedAt, canPublish, reasons: [{ code, message }] }
export async function publishCheck(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  res.json(await publishService.publishCheck(req.api!));
}

// POST /api/organizations/:slug/apis/:apiSlug/publish → 200 { api } (also when already published)
// · 409 PUBLISH_BLOCKED, details = every reason ({ field: NO_DESIGN | DESIGN_INVALID | NO_DATA | NO_ACTIVE_TOKEN, message })
export async function publish(req: Request, res: Response) {
  res.json(await publishService.publishApi(req.api!, req.organization!.slug));
}

// POST /api/organizations/:slug/apis/:apiSlug/unpublish → 200 { api } (also when already a draft)
export async function unpublish(req: Request, res: Response) {
  res.json(await publishService.unpublishApi(req.api!, req.organization!.slug));
}
