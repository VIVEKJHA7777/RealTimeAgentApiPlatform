import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { logger, scrubTokens } from './lib/logger.js';
import { env } from './config/env.js';
import { authRateLimit } from './middleware/auth-rate-limit.js';
import { errorHandler } from './middleware/error-handler.js';
import { loadSession } from './middleware/load-session.js';
import { notFound } from './middleware/not-found.js';
import { frontendRouter } from './middleware/serve-frontend.js';
import { apisRouter } from './modules/apis/apis.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { dataSourcesRouter } from './modules/data-sources/data-sources.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { jivoxRouter } from './modules/jivox/jivox.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import { v1Router } from './modules/v1/v1.routes.js';

// Builds the Express app. Kept separate from index.ts (which starts listening)
// so the app can later be used in tests without opening a port.
export function createApp() {
  const app = express();

  // Don't advertise "X-Powered-By: Express" to the world.
  app.disable('x-powered-by');
  // Behind a proxy (Render: 1), req.ip = the caller's real address (login limits, logs). 6.0
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  // 0. "Are you up?" for uptime pingers (6.0): no DB, no log line, so a ping every few minutes
  //    keeps a free server awake without waking the database or filling the logs.
  app.get('/api/ping', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true });
  });

  // 1. Request logging: one line per request, plus `req.log` inside routes.
  app.use(
    pinoHttp({
      logger,
      // Give every request an id and send it back, so a log line can be matched to a call.
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Keep only what we need in each log line. Headers stay (secrets are redacted
      // in logger.ts) because in Phase 4 we need to see what Jivox sends us.
      serializers: {
        // Token-shaped text is scrubbed from the URL and every header value (a token sent in the
        // wrong place must not land in the logs); authorization / x-api-key are redacted anyway.
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: scrubTokens(req.url),
          headers: Object.fromEntries(
            Object.entries(req.headers as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? scrubTokens(v) : v]),
          ),
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // originalUrl = full path (/api/health). req.url is shortened inside routers (/).
      // writableFinished = false: the browser left before we answered (e.g. a cancelled upload);
      // statusCode would still be the default 200, which would be misleading.
      customSuccessMessage: (req, res, responseTime) =>
        res.writableFinished
          ? `${req.method} ${scrubTokens((req as express.Request).originalUrl)} → ${res.statusCode} (${responseTime}ms)`
          : `${req.method} ${scrubTokens((req as express.Request).originalUrl)} → closed by the client (${responseTime}ms)`,
      customErrorMessage: (req, res) =>
        `${req.method} ${scrubTokens((req as express.Request).originalUrl)} → ${res.statusCode} failed`,
      // For 5xx, pino-http adds a generic "failed with status code" error + stack to the
      // line. Drop it: real errors are already logged with their stack in error-handler.ts.
      customErrorObject: (_req, _res, _err, val) => {
        const { err: _ignored, ...rest } = val;
        return rest;
      },
    }),
  );

  // 1b. The live API (Phase 4) that Jivox calls: own JSON parser + envelope errors, and BEFORE
  //     cookies / sessions on purpose (server-to-server: a token, never a login).
  app.use('/v1', v1Router);

  // 2. Parse JSON request bodies (needed from Phase 1 onwards).
  app.use(express.json({ limit: '1mb' }));

  // 3. Health check BEFORE the session middleware: it must answer even when the DB is
  //    down, and loadSession needs the DB. (The dashboard polls it with the cookie attached.)
  app.use('/api/health', healthRouter);

  // 4. Cookies → req.cookies, then session cookie → req.user / req.sessionId (if valid).
  app.use(cookieParser());
  app.use(loadSession);

  // 5. Routes that may need the logged-in user (login + sign-up attempts limited per IP, 6.0)
  app.use(['/api/auth/login', '/api/auth/signup'], authRateLimit);
  app.use('/api/auth', authRouter);
  app.use('/api/organizations', organizationsRouter);
  app.use('/api/organizations/:slug/data-sources', dataSourcesRouter);
  app.use('/api/organizations/:slug/apis', apisRouter);
  app.use('/api/jivox', jivoxRouter);

  // 5b. The built frontend, when there is one (a server; locally Vite serves it). 6.0
  const frontend = frontendRouter();
  if (frontend) app.use(frontend);

  // 6. Nothing matched → 404. Must come after all routes.
  app.use(notFound);

  // 7. Errors → JSON response. Must be the very last middleware.
  app.use(errorHandler);

  return app;
}
