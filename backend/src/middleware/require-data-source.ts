import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/app-error.js';
import * as dataSourcesService from '../modules/data-sources/data-sources.service.js';

// For routes with a :dataSourceId param, after requireOrganization.
// Loads the data source ONLY if it belongs to this brand (one query, both conditions);
// otherwise 404 (same answer for "doesn't exist" and "another brand's").
export async function requireDataSource(req: Request, _res: Response, next: NextFunction) {
  const dataSourceId = req.params.dataSourceId;
  const dataSource =
    typeof dataSourceId === 'string'
      ? await dataSourcesService.findOwnedDataSource(req.organization!.id, dataSourceId)
      : null;
  if (!dataSource) throw new AppError(404, 'DATA_SOURCE_NOT_FOUND', 'Data source not found');
  req.dataSource = dataSource;
  next();
}
