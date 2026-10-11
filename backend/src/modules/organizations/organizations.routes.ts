// ROUTES layer for brands: method + path → middleware → controller.
import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { requireOrganization } from '../../middleware/require-organization.js';
import * as organizationsController from './organizations.controller.js';

export const organizationsRouter = Router();

// Every brand route needs a logged-in user.
organizationsRouter.use(requireAuth);

organizationsRouter.post('/', organizationsController.create);
organizationsRouter.get('/', organizationsController.list);
organizationsRouter.get('/:slug', requireOrganization, organizationsController.getOne);
