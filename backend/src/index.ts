// Entry point: loads config, builds the app, starts listening.
import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { pgPool } from './lib/pg-pool.js';
import { interruptRunningOnBoot } from './modules/apis/agents/jivox-actions.js';
import { startSwitchSweeper, stopSwitchSweeper } from './modules/apis/switches/switches.service.js';
import { recoverImports } from './modules/data-sources/import/import-runner.js';
import { flushCallLogsNow } from './modules/v1/call-log.js';
import { saveRecentCallsNow } from './modules/v1/recent-calls.js';

const app = createApp();

// Before accepting requests: clean up imports cut off by the last stop/crash.
await recoverImports();
// …and Jivox submits / activations that were waiting for Jivox when it stopped (task 6.3).
const interrupted = await interruptRunningOnBoot();
if (interrupted > 0) logger.warn({ interrupted }, 'Marked Jivox actions cut off by the last stop as interrupted');

// Test switches that ran out while the server was down end now (with their "ended" line), then every 30 s (7.4).
startSwitchSweeper();

const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Graceful shutdown: on Ctrl+C (SIGINT) or a stop signal from a host (SIGTERM),
// stop taking new requests, finish open ones, close DB connections, then exit.
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  stopSwitchSweeper();
  server.close(async () => {
    await saveRecentCallsNow().catch(() => undefined); // the last second's /v1 calls (task 4.8b)
    await flushCallLogsNow(); // …and their call log entries (task 7.2)
    await Promise.all([prisma.$disconnect(), pgPool.end()]);
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
