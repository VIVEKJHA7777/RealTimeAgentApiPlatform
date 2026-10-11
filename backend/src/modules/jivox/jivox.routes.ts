// ROUTES for the Jivox reference data (mounted at /api/jivox). Logged-in users only.
import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import * as jivoxController from './jivox.controller.js';

export const jivoxRouter = Router();

jivoxRouter.use(requireAuth);
jivoxRouter.get('/feed-schemas', jivoxController.list);
jivoxRouter.get('/feed-schemas/:feedType', jivoxController.getOne);
