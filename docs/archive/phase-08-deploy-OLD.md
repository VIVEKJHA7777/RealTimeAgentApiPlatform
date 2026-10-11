# Phase 8: Deploy Online

**Status:** Not started
**Roadmap:** [../ROADMAP.md](../ROADMAP.md)

## 1. Goal (simple words)

Put the app on the internet with a fixed HTTPS URL, so Jivox can call it any time
without the laptop running.

## 2. Why we need it

The tunnel URL changes and dies when the laptop sleeps. Contracts need a stable `base_url`.

## 3. In scope / not in scope

| In scope | Not in scope |
|---|---|
| Choose one host (Render / Railway / Fly) | Kubernetes, multiple regions |
| Hosted PostgreSQL | Monitoring / alerting tools |
| Backend + frontend deploy | CI/CD pipelines (maybe later) |
| Env variables / secrets on the host | Custom domain (optional) |
| Run Prisma migrations on deploy | |

## 4. Tasks (planned)

| # | Task |
|---|---|
| 8.1 | Pick the host and create the DB |
| 8.2 | Production build scripts (backend + frontend) |
| 8.3 | Deploy the backend, run migrations |
| 8.4 | Deploy the frontend |
| 8.5 | Update the Jivox contract `base_url`, verify again |

## 5. Commands log
| # | Task | Where | Command | Why |
|---|---|---|---|---|
| | | | | |

## 6. How to verify manually
- [ ] `https://<host>/api/health` returns ok
- [ ] Jivox contract verified against the hosted URL with the laptop off

## 7. Summary
| | Items |
|---|---|
| Implemented | none yet |
| Verified | none yet |
| Outstanding | 8.1 – 8.5 |
