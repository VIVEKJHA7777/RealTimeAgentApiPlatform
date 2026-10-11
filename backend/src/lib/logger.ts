import { pino } from 'pino';
import { env } from '../config/env.js';

// Anything shaped like an API token ("rtk_" + ≥ 20 token characters). The known token headers are
// redacted below; this catches tokens sent where they don't belong (in the URL, in another
// header) so a caller's mistake never puts a token in our logs.
const TOKEN_LIKE = /rtk_[A-Za-z0-9_-]{20,}/g;
export function scrubTokens(text: string): string {
  return text.replace(TOKEN_LIKE, 'rtk_[Redacted]');
}

export const logger = pino({
  level: env.LOG_LEVEL,
  // Never let secrets reach the logs. Each path is replaced with "[Redacted]".
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
    ],
    censor: '[Redacted]',
  },
  // In development, print colourful human-readable lines.
  // In production, print raw JSON (one object per line) for log tools to read.
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
            singleLine: true,
          },
        }
      : undefined,
});
