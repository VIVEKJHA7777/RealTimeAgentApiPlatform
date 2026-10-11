// CONTROLLER layer for health: turns the service's answer into an HTTP response.
import type { Request, Response } from 'express';
import * as healthService from './health.service.js';

// GET /api/health → is the server up, and can it reach the database?
export async function getHealth(req: Request, res: Response) {
  const status = await healthService.checkDatabase();

  if (status.db === 'down') {
    req.log.warn({ reason: status.reason }, 'Database health check failed');
  }

  const ok = status.db === 'up';
  // 503 = "Service Unavailable": tells monitors something is wrong.
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db: status.db,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
