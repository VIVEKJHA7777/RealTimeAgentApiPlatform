# Phase 3: Tokens and First Realtime API

**Status:** Not started
**Roadmap:** [../ROADMAP.md](../ROADMAP.md)
**Background:** [../PLAN.txt](../PLAN.txt), Part 2 (how a token tells us the brand)

## 1. Goal (simple words)

A brand generates a secret token. Anyone calling our API with that token gets **only
that brand's** data, in the exact Jivox contract format.

## 2. Why we need it

This is the heart of the project. Jivox will send this token on every call, and the
token is how we know which brand the call is for.

## 3. In scope / not in scope

| In scope | Not in scope |
|---|---|
| Generate token (`rtk_` + random), show once | One token per API (Phase 6) |
| Store only the SHA-256 hash + first 8 chars | `Authorization: Bearer` style (Phase 6) |
| List + revoke tokens | POST requests (Phase 6) |
| Token-check middleware (`X-Api-Key`) | Configurable APIs (Phase 5) |
| `GET /v1/:brand/live/prices?ids=A,B,C` (fixed) | Rate limits |
| Contract envelope: status / generated_at / data / errors | |
| `Cache-Control: no-store` on every /v1 response | |
| Unknown ids go in `errors` (NOT_FOUND) | |
| Max 100 ids per call | |

## 4. Tasks (planned)

| # | Task |
|---|---|
| 3.1 | DB table `api_tokens` |
| 3.2 | Token generate / list / revoke endpoints (`/api/tokens`) |
| 3.3 | Frontend tokens page (copy-once dialog, revoke button) |
| 3.4 | `requireApiToken` middleware: hash → look up → brand, check the URL brand matches |
| 3.5 | `GET /v1/:brand/live/prices`: parse ids, query records, build the envelope |
| 3.6 | `no-store` header, error format for 400 / 401 / 403 |

## 5. Commands log
| # | Task | Where | Command | Why |
|---|---|---|---|---|
| | | | | |

## 6. Files created and what they do
| File | What it does |
|---|---|
| | |

## 7. How to verify manually (curl)
- [ ] Good token: 200, `status: success`, data for the known ids
- [ ] One unknown id: listed in `errors` with `NOT_FOUND`, the other ids still in `data`
- [ ] No token: 401
- [ ] Wrong token: 401
- [ ] Brand B's token on brand A's URL: 403
- [ ] Revoked token: 401
- [ ] Response header contains `Cache-Control: no-store`
- [ ] More than 100 ids: 400
- [ ] Logs never show the token

## 8. Common mistakes and security notes
_To be filled during the phase._

## 9. Summary
| | Items |
|---|---|
| Implemented | none yet |
| Verified | none yet |
| Outstanding | 3.1 – 3.6 |
