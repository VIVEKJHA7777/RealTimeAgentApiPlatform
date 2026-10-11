// ROUTES layer for data sources (mounted at /api/organizations/:slug/data-sources).
import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { requireDataSource } from '../../middleware/require-data-source.js';
import { requireOrganization } from '../../middleware/require-organization.js';
import { uploadFile } from '../../middleware/upload-file.js';
import * as dataSourcesController from './data-sources.controller.js';

// mergeParams: lets requireOrganization see :slug from the mount path.
export const dataSourcesRouter = Router({ mergeParams: true });

// Logged in AND owner of this brand (and of the data source) BEFORE any file is accepted:
// strangers can't make us write a 200 MB upload to disk.
dataSourcesRouter.use(requireAuth, requireOrganization);

dataSourcesRouter.get('/', dataSourcesController.list);
dataSourcesRouter.post('/preview', uploadFile, dataSourcesController.preview);
dataSourcesRouter.post('/', uploadFile, dataSourcesController.create);

// Everything below works on ONE data source of this brand (404 otherwise).
dataSourcesRouter.get('/:dataSourceId', requireDataSource, dataSourcesController.getOne);
dataSourcesRouter.delete('/:dataSourceId', requireDataSource, dataSourcesController.remove);
dataSourcesRouter.get(
  '/:dataSourceId/records',
  requireDataSource,
  dataSourcesController.listRecords,
);
dataSourcesRouter.get('/:dataSourceId/download', requireDataSource, dataSourcesController.download);
dataSourcesRouter.get(
  '/:dataSourceId/imports',
  requireDataSource,
  dataSourcesController.listImports,
);
dataSourcesRouter.post(
  '/:dataSourceId/imports',
  requireDataSource,
  uploadFile,
  dataSourcesController.startImport,
);
dataSourcesRouter.get(
  '/:dataSourceId/imports/:importId',
  requireDataSource,
  dataSourcesController.getImport,
);
