// ROUTES layer: only maps "method + path" to a controller function (plus middleware).
// No logic here, so this file reads like a table of contents of the module.
import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import * as authController from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/signup', authController.signup);
authRouter.post('/login', authController.login);
authRouter.post('/logout', requireAuth, authController.logout);
authRouter.get('/me', requireAuth, authController.me);
