// Loads variables from backend/.env into process.env, then checks them.
// The rest of the app imports `env` from here and never reads process.env directly.
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must start with postgresql://'),

  // ── Data uploads (Phase 2). Defaults cover files of 500 000+ rows. ──
  // Largest file accepted, in megabytes.
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(200),
  // Where uploaded files wait until they're read. Defaults to the system temp folder.
  UPLOAD_TMP_DIR: z.string().min(1).optional(),
  // Most rows / columns one data source may have.
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(1_000_000),
  IMPORT_MAX_COLUMNS: z.coerce.number().int().positive().default(200),
  // How many imports may run at the same time (each uses one DB connection + some CPU).
  IMPORT_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  // How many CSV downloads may stream at the same time (each holds one DB connection while it
  // runs; more at once → 429, so downloads can never use up the connections imports need).
  DOWNLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
  // How many full-data value checks (design: "how many rows can't convert", reads every row)
  // may run at the same time; more at once → 429.
  VALUE_CHECK_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),

  // Database connections the app keeps (Prisma's pool; COPY has its own small pool). Each /v1
  // call holds one for ~2 ms, so 10 serve thousands of calls a second. Postgres allows 100 in all
  // (shared by every backend on this server). A call that waits > 3 s for one gets 503 "busy".
  DB_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),

  // ── API tokens (Phase 4) ──
  // Encrypts the stored copy of every API token (so the owner can view it again).
  // 32 random bytes, base64. Make one with:  openssl rand -base64 32
  // Required: without it the server doesn't start. Keep it out of git and never change it casually:
  // tokens made with an old key keep WORKING (calls use the hash) but can't be SHOWN any more.
  TOKEN_ENCRYPTION_KEY: z
    .string({ error: 'is required (make one with: openssl rand -base64 32)' })
    .refine((v) => /^[A-Za-z0-9+/]{43}=$/.test(v.trim()), 'must be 32 bytes in base64 (make one with: openssl rand -base64 32)'),
  // The address Jivox uses to reach this server (shown in curl commands). No trailing slash.
  // An empty line in .env (`PUBLIC_BASE_URL=`) counts as not set.
  PUBLIC_BASE_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
      .transform((v) => v.replace(/\/+$/, ''))
      .optional(),
  ),

  // ── Running on a server (task 6.0) ──
  // Who may create an account. Not set: anyone in development, NOBODY in production (the app is on
  // the internet). "*" = anyone; or a comma list of emails and "@domain" endings:
  //   SIGNUP_ALLOWED_EMAILS=vivek@jivox.com,@jivox.com
  SIGNUP_ALLOWED_EMAILS: z.string().trim().max(5000).optional(),
  // Login + sign-up attempts per IP per 15 minutes (guards passwords and the CPU that hashing
  // them costs). 0 = no limit. Not set: 0 in development (test scripts sign up a lot), 30 in production.
  AUTH_ATTEMPTS_PER_15_MIN: z.coerce.number().int().min(0).max(10_000).optional(),
  // How many proxies sit in front of the app (Render: 1), so req.ip is the caller's real address.
  // 0 = none (local). Never more than there really are: the extra X-Forwarded-For hops are forgeable.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // The built frontend (frontend/dist) served by this server, so the whole app is one https
  // address (the login cookie then works without CORS). Not set: ../frontend/dist when it exists.
  FRONTEND_DIST: z.string().min(1).optional(),
  // Set by Render on every service ("https://<name>.onrender.com"): the default PUBLIC_BASE_URL there.
  RENDER_EXTERNAL_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.url({ protocol: /^https?$/ }).optional(),
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: better to refuse to start than to run with a broken config.
  console.error('Invalid environment variables:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

const production = parsed.data.NODE_ENV === 'production';
export const env = {
  ...parsed.data,
  PUBLIC_BASE_URL:
    parsed.data.PUBLIC_BASE_URL ?? parsed.data.RENDER_EXTERNAL_URL?.replace(/\/+$/, '') ?? `http://localhost:${parsed.data.PORT}`,
  AUTH_ATTEMPTS_PER_15_MIN: parsed.data.AUTH_ATTEMPTS_PER_15_MIN ?? (production ? 30 : 0),
};
