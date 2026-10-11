# Phase 8: Deploy Online

**Status:** ⬜ Not started (plan draft: detailed review before we start)
**Roadmap:** [../ROADMAP.md](../ROADMAP.md) · **Big picture:** [../PLAN-v2-api-first.md](../PLAN-v2-api-first.md)
**Depends on:** Phases 2–7 (or earlier, if a fixed URL is needed sooner for Jivox testing)

---

## 0. Progress tracker

| # | Task | Side | Status |
|---|---|---|---|
| 8.1 | Choose the host (Render / Railway / Fly) and create the database | Infra | ⬜ |
| 8.2 | Production build: Express also serves the built frontend (one service, one domain) | Backend | ⬜ |
| 8.3 | Production config: env secrets, secure cookies, `trust proxy`, DB over SSL, JSON logs | Backend | ⬜ |
| 8.4 | Hardening: security headers, login rate limit, `/v1` rate limit, body limits | Backend | ⬜ |
| 8.5 | Deploy pipeline: build → `prisma migrate deploy` → start; health check | Infra | ⬜ |
| 8.6 | Move contracts to the real URL: regenerate, resubmit, activate on qa3 | Both | ⬜ |
| 8.7 | Backups + a short runbook (restart, roll back, rotate secrets) + docs | Infra | ⬜ |

---

## 1. Goal (simple words)

The platform runs on the internet at a **fixed HTTPS address**, so Jivox can call the APIs any
time, even when the laptop is off, and contracts never need a new URL again.

## 2. Decisions (proposed)

| # | Decision | Why |
|---|---|---|
| P8-1 | **One service**: Express serves `/api`, `/v1` and the built React app | Same origin → cookies just work, no CORS, one thing to deploy |
| P8-2 | Managed PostgreSQL from the same host, SSL on | No database server to look after |
| P8-3 | Secrets only in the host's environment settings: `DATABASE_URL`, `ENCRYPTION_KEY`, `PUBLIC_API_BASE_URL`… | Never in Git |
| P8-4 | `prisma migrate deploy` on each release (never `migrate dev` in production) | Safe, forward-only migrations |
| P8-5 | `NODE_ENV=production`: `Secure` cookies, JSON logs, no stack traces anywhere | Already built in from Phase 0/1 |
| P8-6 | Add rate limits now (login attempts, `/v1` per token) | Public internet = real risk (accepted gap from Phase 1) |
| P8-7 | Optional Docker image if the host needs one (Docker returns here, see change log) | Repeatable builds |

## 3. Production environment variables

| Name | Example | Used for |
|---|---|---|
| `NODE_ENV` | `production` | secure cookies, logs |
| `PORT` | set by the host | listening port |
| `DATABASE_URL` | host's Postgres URL (`?sslmode=require`) | DB |
| `PUBLIC_API_BASE_URL` | `https://api-platform.example.com` | contracts' `base_url`, curl examples |
| `ENCRYPTION_KEY` | 32 random bytes, base64 | Jivox access keys (Phase 6) |
| `LOG_LEVEL` | `info` | logging |

## 4. How to verify

- [ ] `https://<host>/api/health` → ok; the app loads and login works (cookie `Secure`)
- [ ] A Jivox contract with the real `base_url` is verified and activated on qa3
- [ ] Laptop off → Jivox still gets live answers
- [ ] Too many wrong logins → 429; rate limit on `/v1` per token works
- [ ] Restore from a backup tested once

## 5. Open questions (for the detailed review)

- Which host (company preference, cost, region close to Jivox's servers)?
- A custom domain, or the host's default `*.onrender.com`-style address?
- Should deploy move **earlier** (e.g. right after Phase 4) so Jivox testing uses a fixed URL from the start instead of a tunnel?
