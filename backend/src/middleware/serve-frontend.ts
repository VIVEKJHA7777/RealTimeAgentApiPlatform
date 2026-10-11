// Serves the built frontend (task 6.0), so on a server the whole app is ONE https address:
// the browser's /api calls go to the same origin (the login cookie works, no CORS), exactly like
// Vite's proxy does in development.
//   /assets/*          → the hashed files, cached for a year (a new build has new names)
//   any other GET page → index.html, never cached (React Router picks the page)
//   /api/*, /v1/*      → never here: they stay JSON (a wrong /api path is still a JSON 404)
// Only in production (or with FRONTEND_DIST set); in development Vite serves the pages.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// backend/src/middleware (tsx) and backend/dist/middleware (built) are both 3 levels below the project.
const DEFAULT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/dist');

export function frontendRouter(): Router | null {
  // Locally Vite serves the pages (with hot reload); an old build lying around must not answer instead.
  if (env.NODE_ENV !== 'production' && !env.FRONTEND_DIST) return null;
  const dist = env.FRONTEND_DIST ? path.resolve(env.FRONTEND_DIST) : DEFAULT_DIST;
  const index = path.join(dist, 'index.html');
  if (!existsSync(index)) {
    logger.warn({ dist }, 'No built frontend found: serving the API only');
    return null;
  }
  const router = Router();
  // Basic browser protections for the pages (the API answers are JSON, read by our own code).
  router.use((_req: Request, res: Response, next: NextFunction) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    next();
  });
  router.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '365d', index: false, fallthrough: false }));
  router.use(express.static(dist, { index: false, maxAge: '1h' }));
  router.get(/^(?!\/(api|v1)(\/|$)).*/, (req: Request, res: Response, next: NextFunction) => {
    if (!req.accepts('html')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  logger.info({ dist }, 'Serving the built frontend');
  return router;
}
