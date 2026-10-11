# Phase 4: First Real Test with Jivox

**Status:** Not started
**Roadmap:** [../ROADMAP.md](../ROADMAP.md)

## 1. Goal (simple words)

Connect our laptop API to BrandStore Studio on qa3 and get a contract **verified**.

## 2. Why we need it

This proves the whole idea works end to end before we build more features.

## 3. In scope / not in scope

| In scope | Not in scope |
|---|---|
| Public tunnel (ngrok / cloudflared) to localhost:4000 | Hosting online (Phase 8) |
| Paste our token into the Studio Real Time Agent | POST contracts (Phase 6) |
| Submit a "Sample A" style GET contract | |
| Read our logs to see exactly what Jivox sent | |
| Fix mismatches until verified, then activate | |

## 4. Tasks (planned)

| # | Task |
|---|---|
| 4.1 | Install and start the tunnel, get the public HTTPS URL |
| 4.2 | Upload test data whose ids match the BrandStore feed |
| 4.3 | Generate a token, paste it into Studio → Real-time data → Real Time Agent |
| 4.4 | Write and submit the contract (base_url = tunnel URL + `/v1/<brand>`) |
| 4.5 | Check logs, fix issues, reach `verified` |
| 4.6 | Activate, and check live values in chat |

## 5. Commands log
| # | Task | Where | Command | Why |
|---|---|---|---|---|
| | | | | |

## 6. Contract used
```json
// filled during the phase
```

## 7. How to verify manually
- [ ] Jivox's verification call shows in our logs (method, path, ids)
- [ ] Contract status is `verified`
- [ ] After activation, the live price shows in the chat response

## 8. Problems found and fixes
_To be filled during the phase._

## 9. Summary
| | Items |
|---|---|
| Implemented | none yet |
| Verified | none yet |
| Outstanding | 4.1 – 4.6 |
