# Phase 6: POST, Header Styles, Failure Switches, Request Log

**Status:** Not started
**Roadmap:** [../ROADMAP.md](../ROADMAP.md)

## 1. Goal (simple words)

Support every request style in the Jivox contract doc, and add switches that make the
API fail **on purpose**, so we can test every Jivox verification failure.

## 2. Why we need it

A QA test API must produce both good and bad answers on demand. The request log
shows exactly what Jivox sent (ids, locale, location, literals).

## 3. In scope / not in scope

| In scope | Not in scope |
|---|---|
| POST with one object per row (`items: [{ sku, cat }]`) | Paginated / nested responses |
| Read extra per-row inputs (e.g. `cat`) and `context` | "user" credential tokens |
| Header style per API: `X-Api-Key: {token}` or `Authorization: Bearer {token}` | |
| One token per API (decision D1) | |
| Failure switches (see below) | |
| Request log stored in the DB + log page (token hidden) | |

**Failure switches (per API):**
missing `no-store` header · `status: failure` · duplicate id · drop an id ·
wrong value type · slow response (> 3 s, configurable) · HTTP 500 · empty `data`

## 4. Tasks (planned)

| # | Task |
|---|---|
| 6.1 | POST support in config + runtime |
| 6.2 | Header style option + one token per API |
| 6.3 | `request_logs` table + logging middleware (redacted) |
| 6.4 | Failure switches in config + runtime |
| 6.5 | Frontend: switches panel + request log page |
| 6.6 | Test each switch against Jivox qa3 |

## 5. Commands log
| # | Task | Where | Command | Why |
|---|---|---|---|---|
| | | | | |

## 6. Files created and what they do
| File | What it does |
|---|---|
| | |

## 7. How to verify manually
- [ ] The Sample B style POST contract is verified on qa3
- [ ] The Bearer header style works
- [ ] Each failure switch → the Jivox contract becomes `failed` with matching evidence
- [ ] The request log shows the body / query and the redacted headers

## 8. Results per switch
| Switch | Expected Jivox result | Actual |
|---|---|---|
| | | |

## 9. Summary
| | Items |
|---|---|
| Implemented | none yet |
| Verified | none yet |
| Outstanding | 6.1 – 6.6 |
