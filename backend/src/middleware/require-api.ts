import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error.js';
import * as apisService from '../modules/apis/apis.service.js';

// For routes with an :apiSlug param, after requireOrganization.
// Loads the API ONLY if it belongs to this brand (one query, both conditions);
// otherwise 404 (same answer for "doesn't exist" and "another brand's").
export async function requireApi(req: Request, _res: Response, next: NextFunction) {
  const apiSlug = req.params.apiSlug;
  const api =
    typeof apiSlug === 'string'
      ? await apisService.findOwnedApi(req.organization!.id, apiSlug)
      : null;
  if (!api) throw new AppError(404, 'API_NOT_FOUND', 'API not found');
  req.api = api;
  next();
}
