# Deploy for free: Render (app) + Neon (database)

Task 6.0, 2026-10-12. The whole app (pages, `/api`, the live `/v1` that Jivox calls) runs as **one free Render
web service** at `https://<name>.onrender.com`; the database is a **free Neon Postgres**. Proper Docker / company
deploy comes in Phase 8; everything here (settings, migrations on start) carries over.

```
Jivox qa3 ──https──► Render (free web service, Node 22)  ──TLS──► Neon (free Postgres, same region)
you (browser) ─────►   backend: /api, /v1 + the built frontend
UptimeRobot ──every 5 min──► /api/ping (keeps Render awake; doesn't touch the DB)
```

## 0. Before you start

- **Check with Jivox** that this code and the agents' qa3 access keys may live on an outside host.
- Free limits to know: Render free = 512 MB RAM, 0.1 CPU, 750 hours / month (one always-on service), sleeps
  after 15 min without traffic (the pinger in step 6 prevents that). Neon free = 0.5 GB storage, pauses after 5 min
  (wakes in under a second). Keep big tests (5 lakh rows) on your Mac; uploads here are limited to 50 MB / 200 000 rows.
- ONE region for both: the Neon project is in **AWS US East 2 (Ohio)**, so `render.yaml` says `region: ohio`.
  (Render's regions: oregon, ohio, virginia, frankfurt, singapore; change both if Jivox's qa3 is far from Ohio.)

## 1. Neon: the database (5 min)

1. Sign up at **neon.com** (GitHub login is fine) → **New project** (done 2026-10-12: `RealTimeAgent`, AWS US East 2
   (Ohio), branch `production`). Any recent Postgres version works (no 18-only features are used).
2. Project dashboard → **Connect** → turn **Connection pooling OFF** (we want the direct address) → copy the
   connection string. It looks like
   `postgresql://neondb_owner:…@ep-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require`.
   This is a password: keep it out of chat, git and screenshots.

## 2. The encryption key (1 min)

```bash
openssl rand -base64 32
```
Save the output in your password manager. It encrypts the stored tokens and the agents' access keys. Use a
**new** one (never your laptop's), and don't lose it: without it saved tokens can't be shown and access keys
must be pasted again.

## 3. GitHub: a private repo with just this project (5 min)

Render builds from GitHub and reads `render.yaml` at the **root** of the repo. Your copy lives inside the company
repo, so make a separate private repo for this project (this also avoids giving Render access to the company repo):

1. github.com → **New repository** → name `real-time-data-platform`, **Private**, no README.
2. Copy the project out (no `node_modules`, no `.env`, no builds) and push it:
```bash
rsync -a --delete --exclude node_modules --exclude .env --exclude dist --exclude backend/src/generated ~/Documents/jivox-qa-internal-repo/jivox-qa-internal-projects/Real-Time-data-Platform/ ~/Documents/rtdp-deploy/
```
```bash
cd ~/Documents/rtdp-deploy && git init -b main && git add . && git commit -m "Deploy copy" && git remote add origin https://github.com/<you>/real-time-data-platform.git && git push -u origin main
```
3. Check on GitHub that no `.env` file was pushed (only `.env.example`).

Later updates: run the `rsync` again, then `git add . && git commit -m "…" && git push`. Render redeploys by itself.

## 4. Render: the app (10 min, then ~5 min build)

1. Sign up at **render.com** with GitHub, allow it to see the `real-time-data-platform` repo only.
2. **New → Blueprint** → pick the repo → Render reads `render.yaml` and shows one service `api-platform`, plan Free.
3. It asks for the 3 secret values:
   - `DATABASE_URL`: the Neon string from step 1
   - `TOKEN_ENCRYPTION_KEY`: the key from step 2
   - `SIGNUP_ALLOWED_EMAILS`: your email (e.g. `you@jivox.com`), or `@jivox.com` for anyone at Jivox
4. **Apply**. Watch the deploy log: the build (frontend, then backend), then
   `All migrations have been successfully applied` and `Server listening on … (production)`.
5. Your address is at the top of the service page: `https://api-platform-xxxx.onrender.com`.

## 5. First use

1. Open the address → **Sign up** with the allowed email → create a brand → upload a CSV → design → token →
   **Publish**. The Test tab's curl now shows the public https address and works from any machine.
2. Jivox tab → add your agents (MCP destination + access key from Studio) → **Read from Jivox** → the checklist's
   "Jivox can reach the base URL" is now ✓. That's the green light for the rest of Phase 6.
3. Paste each agent's token in Studio (Real-time data → the agent → ACCESS KEYS → Agent access token) as before.

## 6. Keep it awake (3 min)

Free Render services sleep after 15 min without traffic and take 30–60 s to wake: Jivox's 3 s timeout would fail.
**uptimerobot.com** (free) → **New monitor** → HTTP(s) → URL `https://<your address>/api/ping` → every **5 minutes**.
`/api/ping` doesn't touch the database, so Neon can still pause (its first call afterwards is < 1 s slower).

## 7. Check the deploy (from your Mac)

```bash
BASE=https://<your address> ALLOWED=<an allowed email with no account yet> SKIP_LIMIT=1 bash ~/Documents/api-platform/docs/test-scripts/phase-06-task-6.0-deploy.sh
```
It creates an account with `ALLOWED` (allow e.g. `you+check@jivox.com` for it, or use `@jivox.com`) and a small
test brand. Expect `RESULT: 15 passed` (19 with the limit part, which can't be tested from outside through Render's proxy).
Afterwards delete that account from Neon's SQL editor: `DELETE FROM users WHERE email='…';` (its brand goes with it).

## 8. When something is wrong

| You see | Why / fix |
|---|---|
| Build fails at `npm ci` | a `package-lock.json` is missing or out of date: run `npm install` in that folder on your Mac, commit, push |
| Log: `Invalid environment variables` | a secret is missing or malformed (the key must be the 44-character `openssl` output) |
| Log: database connection errors | the Neon string: direct (not pooled), ends with `?sslmode=require`, no spaces |
| First page takes ~1 minute | the service was asleep: set up the pinger (step 6) |
| Sign-up says "closed" | your email isn't in `SIGNUP_ALLOWED_EMAILS` (Render → service → Environment; saving restarts it) |
| Upload refused (too big / too many rows) | free-plan limits in `render.yaml` (`UPLOAD_MAX_MB`, `IMPORT_MAX_ROWS`) |
| Neon says storage is full | delete old data sources (Data tab) or brands you don't use |
| Suspended at the end of the month | the 750 free hours ran out: only ONE always-on free service per account |

Never put the Neon string, the encryption key or tokens in git, chat or screenshots. If one leaks: Neon → reset the
password (update `DATABASE_URL`); tokens → Renew them in the app.
