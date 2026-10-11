# Phase 0: Project Setup and Foundation

**Status:** In progress (0.1–0.9 verified by you; 0.10–0.13 built, waiting for your check)
**Roadmap:** [../ROADMAP.md](../ROADMAP.md)

---

## 1. Goal (simple words)

Make an empty but **working** app with three parts that can talk to each other:

```
React website (5173)  ──/api──►  Express server (4000)  ──►  PostgreSQL (5432, Homebrew)
```

No features yet, only a strong base. Every later phase builds on this.

## 2. Why we need it

- **Folder structure** decides where future code goes. Good structure now means less mess later.
- **Env config** keeps secrets (DB password, etc.) out of the code.
- **Logging** shows us what the server is doing. In Phase 4 we will read logs to see
  exactly what Jivox sends us, so logs must be clear and must **hide secrets**.
- **Error handling** stops the server from crashing or leaking internal details.
- **Health check** is the simplest proof that everything is connected.

## 3. In scope / not in scope

| In scope | Not in scope |
|---|---|
| Folders, Git, .gitignore, README | Login (Phase 1) |
| Project database + DB user in local PostgreSQL | Real database tables (Phase 1+) |
| Express + TypeScript + hot reload | Deploying (Phase 8) |
| Env variables checked with Zod | Docker (dropped for now, see roadmap change log) |
| pino logging with secret hiding | Log files / log services |
| Error handler + 404 handler | |
| `GET /api/health` (server and DB status) | |
| Prisma connected to PostgreSQL | |
| React + Vite + Tailwind + shadcn + React Router | |
| Dashboard shell + green/red health badge | |

## 4. Tasks

| # | Task | What you will see when it works | Status |
|---|---|---|---|
| 0.1 | Check tools (Node, npm, Git, PostgreSQL) | Version numbers print | ✅ Verified |
| 0.2 | Create folders, `git init`, `.gitignore`, README | Folder tree matches section 7 | ✅ Verified |
| 0.3 | Create the project DB user and database | `psql` login as `api_platform` works | ✅ Verified |
| 0.4 | Backend: npm init, TypeScript, Express, hot reload | `npm run dev` prints "Server listening on http://localhost:4000" | ✅ Verified |
| 0.5 | Env config with Zod (`config/env.ts`) | A bad/missing variable gives a clear error on start | ✅ Verified |
| 0.6 | Logging with pino (secrets hidden) | One log line per request, `x-api-key` shows `[Redacted]` | ✅ Verified |
| 0.7 | Error handler + 404 handler | Unknown URL gives a JSON 404, not an HTML page | ✅ Verified |
| 0.8 | `GET /api/health` | `curl` returns `{"status":"ok", ...}` | ✅ Verified |
| 0.9 | Prisma connect; health also checks the DB | `"db":"up"`; stop Postgres → `"db":"down"` + HTTP 503 | ✅ Verified |
| 0.10 | Frontend: Vite + React + TypeScript | `npm run build` passes | Built |
| 0.11 | Tailwind + shadcn/ui + React Router | Styled Card / Button / Badge render | Built |
| 0.12 | Vite proxy `/api` → backend; dashboard shell | Sidebar + header layout visible; `curl localhost:5173/api/health` works | Built |
| 0.13 | Health badge on dashboard | Green "Backend OK · DB OK"; red "DB down" / "Backend offline" | Built |
| 0.14 | First Git commit + push to GitHub | Repo visible on GitHub | Skipped (your decision, 2026-10-09; do it whenever you like) |

---

## 5. Commands log

> **Where** = the folder to run the command in. In your own copy, replace
> `api-platform` with your folder name.

### Tasks 0.1 – 0.3 (done)

| # | Task | Where | Command | Why |
|---|---|---|---|---|
| 1 | 0.1 | anywhere | `node -v` | Check Node is installed. Got **v22.22.3** (need 20+). |
| 2 | 0.1 | anywhere | `npm -v` | Check npm. Got **10.9.8**. |
| 3 | 0.1 | anywhere | `git --version` | Check Git. Got **2.47.0**. |
| 4 | 0.1 | anywhere | `docker --version` | Check Docker: **not installed**, so we use Homebrew Postgres instead. |
| 5 | 0.1 | anywhere | `brew services list \| grep postgres` | Check Postgres runs as a background service. Got `postgresql@18 started`. |
| 6 | 0.1 | anywhere | `pg_isready` | Ask Postgres "are you accepting connections?" Got `/tmp:5432 - accepting connections`. |
| 7 | 0.2 | `~/Documents` | `mkdir -p api-platform/backend api-platform/docs/phases` | Create the project folders. (`frontend/` is created later by Vite.) |
| 8 | 0.2 | `api-platform/` | `git init -b main` | Start a Git repo with `main` as the first branch. |
| 9 | 0.2 | `api-platform/` | *(create `.gitignore` and `README.md` by hand)* | |
| 10 | 0.3 | anywhere | `psql postgres -c "CREATE ROLE api_platform WITH LOGIN PASSWORD 'api_platform_dev_pw' CREATEDB;"` | Create a **separate DB user** just for this app. |
| 11 | 0.3 | anywhere | `psql postgres -c "CREATE DATABASE api_platform_dev OWNER api_platform;"` | Create the app's own database, owned by that user. |
| 12 | 0.3 | anywhere | `psql "postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_dev" -c "SELECT current_user, current_database();"` | Prove we can log in as the new user. |

### Tasks 0.4 – 0.9 (backend)

| # | Task | Where | Command | Why |
|---|---|---|---|---|
| 13 | 0.4 | `api-platform/backend` | `npm init -y` | Create `package.json` (the project's ID card: name, scripts, dependencies). `-y` = accept all defaults; we edit it after. |
| 14 | 0.4 | `api-platform/backend` | `npm install express zod pino pino-http dotenv @prisma/client@7 @prisma/adapter-pg@7` | **Runtime** packages: needed when the app runs (see the package table below). |
| 15 | 0.4 | `api-platform/backend` | `npm install -D typescript tsx @types/node@22 @types/express pino-pretty prisma@7` | **Dev** packages (`-D`): only needed while developing, not in production. |
| 16 | 0.9 | `api-platform/backend` | `npx prisma init --datasource-provider postgresql --output ../src/generated/prisma` | Create the Prisma starter files. `npx` runs a tool installed in this project. **You will see `prisma7.config.ts`, `.claude/`, `.windsurf/`, `.agents/`, `skills-lock.json`, `.gitignore` appear. This is expected; #17 and #18 clean it up.** Also `.env` gets a placeholder `johndoe` URL; overwrite it in #19. |
| 17 | 0.9 | `api-platform/backend` | `rm -rf .claude .windsurf .agents skills-lock.json .gitignore` | Clean-up: Prisma init also adds AI-editor helper files and its own `.gitignore`. We don't need them (our root `.gitignore` covers everything). |
| 18 | 0.9 | `api-platform/backend` | `mv prisma7.config.ts prisma.config.ts` | Prisma named the file `prisma7.config.ts`; rename it to the standard name the Prisma CLI looks for. |
| 19 | 0.4 | `api-platform/backend` | *(replace `package.json`, create `tsconfig.json`, `.env`, `.env.example`, edit `prisma/schema.prisma`, see section 6)* | |
| 20 | 0.5–0.9 | `api-platform/backend` | *(create all files in `src/`, see section 6)* | |
| 21 | 0.9 | `api-platform/backend` | `npx prisma generate` | Build the TypeScript database client into `src/generated/prisma/`. **Re-run after every change to `schema.prisma`.** |
| 22 | all | `api-platform/backend` | `npm run typecheck` | Ask TypeScript to check every file for mistakes without running anything. No output = no errors. |
| 23 | all | `api-platform/backend` | `npm run dev` | Start the server with hot reload (restarts on every file save). Stop with `Ctrl+C`. |

**Testing commands** (run in a **second** terminal while `npm run dev` is running):

| # | Command | Expected result |
|---|---|---|
| 24 | `curl -i localhost:4000/api/health` | `HTTP/1.1 200 OK`, an `X-Request-Id` header, and `{"status":"ok","db":"up",...}` |
| 25 | `curl localhost:4000/api/nope` | `{"error":{"code":"NOT_FOUND","message":"Route GET /api/nope not found"}}` |
| 26 | `curl -X POST localhost:4000/api/health -H 'content-type: application/json' -d '{bad'` | `{"error":{"code":"BAD_REQUEST",...}}` (broken JSON is rejected cleanly) |
| 27 | `curl localhost:4000/api/health -H 'x-api-key: rtk_SUPERSECRET'` | In the **server** terminal the log shows `"x-api-key":"[Redacted]"` |
| 28 | `brew services stop postgresql@18` then `curl -i localhost:4000/api/health` | HTTP **503** and `"db":"down"`; log says `Database health check failed ... "reason":"ECONNREFUSED"` |
| 29 | `brew services start postgresql@18` then `curl localhost:4000/api/health` | Back to 200 and `"db":"up"` (no server restart needed) |
| 30 | `DATABASE_URL= npx tsx src/index.ts` | `Invalid environment variables: ✖ must start with postgresql:// → at DATABASE_URL` and exit code 1 |

> **Your own folder:**
> - Use your own database in **your** `backend/.env`:
>   `DATABASE_URL="postgresql://api_platform:api_platform_dev_pw@localhost:5432/api_platform_mine"`
> - My server is stopped, so port 4000 is free. If you ever run both at the same time,
>   set `PORT=4001` in your `.env`.
> - `npm audit` shows 4 "high" warnings. They come from packages used **inside the Prisma CLI**
>   (a dev tool, `deepmerge-ts` and `mysql2`). They don't run in our server, and we don't use MySQL.
>   **Don't** run `npm audit fix --force`: it would downgrade Prisma to v6 and break the setup.

### Tasks 0.10 – 0.13 (frontend)

| # | Task | Where | Command | Why |
|---|---|---|---|---|
| 31 | 0.10 | `api-platform/` | `npm create vite@latest frontend -- --template react-ts --no-interactive` | Create the React + TypeScript starter in a new `frontend/` folder. `--` passes the next options to `create-vite`; `--no-interactive` skips the questions. |
| 32 | 0.10 | `api-platform/frontend` | `npm install` | Install the packages listed by the template (React, Vite, TypeScript, oxlint). |
| 33 | 0.11 | `api-platform/frontend` | `npm install tailwindcss @tailwindcss/vite react-router` | Tailwind CSS v4 + its Vite plugin, and React Router for pages. |
| 34 | 0.11 | `api-platform/frontend` | *(edit `vite.config.ts`, replace `src/index.css` with the single line `@import "tailwindcss";`, add `"paths"` to `tsconfig.json` and `tsconfig.app.json`, see section 6)* | shadcn's init **checks** that Tailwind and the `@/` alias already work, so this must come first. |
| 35 | 0.11 | `api-platform/frontend` | `npx shadcn@latest init --template vite --base radix --preset nova --no-monorepo --yes` | Set up shadcn/ui: creates `components.json`, `src/lib/utils.ts`, `src/components/ui/button.tsx`, adds theme colours to `index.css`, installs its helper packages. Without `--preset` it asks a question with arrow keys; **Nova** is the default choice. |
| 36 | 0.11 | `api-platform/frontend` | `npx shadcn@latest add card badge --yes` | Copy the Card and Badge components into `src/components/ui/`. |
| 37 | 0.10 | `api-platform/frontend` | `rm src/App.css src/assets/* public/icons.svg README.md && rmdir src/assets` | Remove the Vite demo page files we don't use. |
| 38 | 0.12–0.13 | `api-platform/frontend` | *(create/replace the `src/` files, see section 6)* | |
| 39 | 0.10 | `api-platform/frontend` | *(in `package.json` set `"name": "api-platform-frontend"`, `"version": "0.1.0"`; in `index.html` set `<title>API Platform</title>`)* | Cosmetic. |
| 40 | all | `api-platform/frontend` | `npm run build` | Type-check (`tsc -b`) **and** make a production build into `dist/`. Must end with `✓ built`. |
| 41 | all | `api-platform/frontend` | `npm run lint` | Run oxlint. 2 warnings in `ui/badge.tsx` and `ui/button.tsx` are expected (shadcn's own files); ignore them. |
| 42 | all | `api-platform/frontend` | `npm run dev` | Start the website at http://localhost:5173 (hot reload). **The backend must also be running** (`npm run dev` in `backend/`, separate terminal). |

**Testing (3 terminals: backend `npm run dev`, frontend `npm run dev`, one free):**

| # | Command / action | Expected result |
|---|---|---|
| 43 | `curl localhost:5173/api/health` | Same JSON as `localhost:4000/api/health`, which proves the Vite proxy forwards to Express |
| 44 | Open http://localhost:5173 | Sidebar "API Platform" + "Dashboard", Welcome card, badge 🟢 **Backend OK · DB OK** |
| 45 | `brew services stop postgresql@18`, wait ≤ 5 s | Badge 🔴 **Backend OK · DB down** |
| 46 | `brew services start postgresql@18`, wait ≤ 5 s | Badge 🟢 again |
| 47 | Stop the backend (`Ctrl+C` in its terminal), wait ≤ 5 s | Badge 🔴 **Backend offline**; Vite's terminal prints `http proxy error: /api/health ... ECONNREFUSED` (expected) |
| 48 | Open http://localhost:5173/anything | "Page not found" inside the layout |

### Packages explained

| Package | Type | What it does for us |
|---|---|---|
| `express` | runtime | The web server framework: routes, middleware, responses. Version 5. |
| `zod` | runtime | Describes the shape data must have and checks it (env now, request bodies later). |
| `pino` | runtime | Fast logger that writes structured (JSON) logs. |
| `pino-http` | runtime | Plugs pino into Express: logs every request automatically and gives us `req.log`. |
| `dotenv` | runtime | Reads `backend/.env` into `process.env`. |
| `@prisma/client` | runtime | The base for the generated database client. |
| `@prisma/adapter-pg` | runtime | Prisma 7 talks to Postgres through the `pg` driver via this adapter. |
| `typescript` | dev | The TypeScript compiler (`tsc`). We use it to type-check and later to build. |
| `tsx` | dev | Runs `.ts` files directly (no build step), and `tsx watch` restarts on file changes. |
| `@types/node`, `@types/express` | dev | Type definitions so TypeScript knows Node's and Express's functions. `@types/node@22` matches our Node 22. |
| `pino-pretty` | dev | Turns JSON logs into readable coloured lines in development. |
| `prisma` | dev | The Prisma CLI: `generate`, `migrate`, `studio`. |

**Frontend packages**

| Package | Added by | What it does for us |
|---|---|---|
| `react`, `react-dom` | template | React itself, and the part that draws it into the browser page. |
| `vite`, `@vitejs/plugin-react` | template | Dev server with instant reload + production bundler; the plugin teaches Vite about JSX/React. |
| `typescript`, `@types/react`, `@types/react-dom`, `@types/node` | template | Type checking. |
| `oxlint` | template | A very fast linter (finds suspicious code, like ESLint). |
| `tailwindcss`, `@tailwindcss/vite` | us | Tailwind CSS v4: style with classes like `flex p-4 text-sm`. v4 needs **no** `tailwind.config.js`; the Vite plugin does it all. |
| `react-router` | us | Maps URLs to pages (`/` → Dashboard). Version 8. |
| `radix-ui` | shadcn | Accessible building blocks (focus, keyboard, ARIA) under shadcn components. |
| `class-variance-authority` | shadcn | Defines component "variants" (e.g. Button `default` / `outline`). |
| `cn` | shadcn | Joins class names and resolves Tailwind conflicts (`cn('p-2', 'p-4')` → `p-4`). |
| `lucide-react` | shadcn | Icon set (`LayoutDashboard` in the sidebar). |
| `tw-animate-css` | shadcn | Animation classes for dialogs/menus later. |
| `@fontsource-variable/geist` | shadcn | The Geist font, bundled locally (no Google Fonts request). |
| `shadcn` | shadcn | Provides `shadcn/tailwind.css` imported in `index.css`, plus the CLI. |

## 6. Files created and what they do

### Root files (tasks 0.2)

| File | What it does |
|---|---|
| `.gitignore` | Files Git must **never** save: `node_modules/`, `dist/`, `backend/src/generated/` (Prisma output, re-creatable), every `.env` except `.env.example`, logs, Mac/editor files. |
| `README.md` | Front page: what the project is, requirements, folder layout. |

### Backend config files

| File | What it does |
|---|---|
| `backend/package.json` | Project ID card. Key lines: `"type": "module"` means we use modern `import/export` (ES modules). **Scripts**: `dev` = run with hot reload, `build` = compile TS→JS into `dist/`, `start` = run the compiled JS (production), `typecheck` = check types only, `prisma:generate` = rebuild the DB client. |
| `backend/package-lock.json` | Auto-created by npm. Records the **exact** version of every package so every install is identical. Commit it; never edit it by hand. |
| `backend/tsconfig.json` | TypeScript settings. `module/moduleResolution: NodeNext` = follow Node's real ES-module rules. `rootDir: src`, `outDir: dist` = compile `src/` into `dist/`. `strict: true` = strictest checks (catches the most bugs). `skipLibCheck` = don't type-check inside `node_modules` (faster). |
| `backend/.env` | **Real** values: `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`. Not committed. |
| `backend/.env.example` | Same variable names with fake values + a comment for each. Committed, so others know what to fill in. |
| `backend/prisma/schema.prisma` | Database schema. Now it only says *which* database (`postgresql`) and *where* to put the generated client. Tables come in Phase 1. |
| `backend/prisma.config.ts` | Prisma 7 CLI config: where the schema and migrations live, and the DB URL (read from `.env` via `import "dotenv/config"`). Used by `prisma` commands, **not** by our running server. |

### Backend source files (`backend/src/`)

They load in this order when the server starts:

```
index.ts
 ├─ config/env.ts        (1) load .env + validate → `env`
 ├─ app.ts               (2) build the Express app
 │   ├─ lib/logger.ts         uses env.LOG_LEVEL
 │   ├─ middleware/*.ts
 │   └─ modules/health/health.routes.ts
 │        └─ lib/prisma.ts    uses env.DATABASE_URL
 └─ app.listen(4000)     (3) start accepting requests
```

| File | What it does |
|---|---|
| `src/config/env.ts` | `import 'dotenv/config'` loads `.env`. A **Zod schema** lists each variable, its type and default. `z.coerce.number()` turns the text `"4000"` into the number `4000` (env values are always text). `safeParse` checks everything at once; if anything is wrong, it prints a readable message and **exits** (fail fast). The rest of the app imports `env`, which is fully typed: `env.PORT` is a `number`. |
| `src/lib/logger.ts` | Creates the one **pino** logger. `redact` lists header paths that are replaced with `[Redacted]` before anything is written: `authorization`, `cookie`, `x-api-key`, `set-cookie`. In development, `pino-pretty` prints coloured single lines; in production, plain JSON. |
| `src/lib/prisma.ts` | Creates the **one shared** Prisma client. Prisma 7 needs a **driver adapter** (`PrismaPg`) that holds the connection pool. `connectionTimeoutMillis: 3000` = give up after 3 s if the DB is unreachable. |
| `src/app.ts` | Builds the Express app; the **order of `app.use` matters**: (1) `pinoHttp` logs every request, gives each one an `X-Request-Id`, and adds `req.log`; (2) `express.json` reads JSON bodies (max 1 MB); (3) routes; (4) `notFound` for anything unmatched; (5) `errorHandler` last. Also turns off the `X-Powered-By: Express` header (don't tell attackers what we run). |
| `src/middleware/not-found.ts` | If no route matched, reply `404` with a JSON error (Express's default is an HTML page). |
| `src/middleware/error-handler.ts` | Express knows it's an error handler because it has **4 parameters** `(err, req, res, next)`. In Express 5, errors thrown in `async` routes come here automatically. 4xx errors (e.g. broken JSON) → send the message back. 5xx (our bugs) → log the full stack, but send only `"Something went wrong"` (never leak internals). |
| `src/modules/health/health.routes.ts` | `GET /api/health`. Runs `SELECT 1` on the DB. Success → `200 {status:"ok", db:"up"}`. Failure → `503 {status:"degraded", db:"down"}` and logs a short reason like `ECONNREFUSED`. |
| `src/index.ts` | Entry point. Builds the app, starts listening on `env.PORT`. **Graceful shutdown**: on `Ctrl+C` (SIGINT) or a host's stop signal (SIGTERM), stop taking new requests, finish open ones, close DB connections, then exit. |
| `src/generated/prisma/` | **Generated** by `npx prisma generate`. Never edit; not committed. |

### Frontend files (`frontend/`)

| File | What it does |
|---|---|
| `index.html` | The single HTML page. Has an empty `<div id="root">` and loads `src/main.tsx`. React fills in everything else. |
| `vite.config.ts` | Vite settings: plugins `react()` + `tailwindcss()`; **alias** `@` → `src/`; **proxy**: any request to `/api/*` is forwarded to `http://localhost:4000`. |
| `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` | TypeScript settings. `tsconfig.json` just points to the other two: `.app` for code in `src/` (browser), `.node` for `vite.config.ts` (runs in Node). We added `"paths": { "@/*": ["./src/*"] }` to the first two so TypeScript understands `@/` too. |
| `components.json` | shadcn's settings: style (`radix-nova`), CSS file, where to put components (`@/components/ui`), icon library. Used by `npx shadcn add ...`. |
| `.oxlintrc.json` | Lint rules (React hooks rules, fast-refresh warning). |
| `.gitignore` | From the template (node_modules, dist, `*.local`). Our root `.gitignore` covers the rest. |
| `src/main.tsx` | **Entry point.** Mounts `<App />` into `#root`, wrapped in `<BrowserRouter>` (enables URL-based pages) and `<StrictMode>` (dev-only extra checks; it runs effects twice in dev, which is normal). Imports `index.css`. |
| `src/index.css` | `@import "tailwindcss"` + shadcn's theme: CSS variables like `--background`, `--primary`, `--muted` that the `bg-muted`, `text-muted-foreground` classes use. Change colours here, not in each component. |
| `src/App.tsx` | **Routes.** `<Route element={<AppLayout />}>` wraps the child routes: `index` (`/`) → Dashboard, `*` (anything else) → Not found. |
| `src/components/layout/AppLayout.tsx` | The frame: left **sidebar** (from `NAV_ITEMS`, `NavLink` highlights the active page), top **header** with the health badge, and `<Outlet />` = "put the current page here". |
| `src/components/HealthBadge.tsx` | Calls `getHealth()` now and then **every 5 s** (`setInterval` inside `useEffect`). Four states: checking (grey), ok (green), db-down (red), offline (red). The cleanup function stops the timer when the component disappears. |
| `src/lib/api.ts` | **The only file that calls the backend.** `getHealth()` fetches `/api/health`. Tells "backend down" (non-JSON proxy error) apart from "DB down" (JSON with `db: "down"`). |
| `src/lib/utils.ts` | The `cn()` class-name helper (from shadcn). |
| `src/components/ui/button.tsx`, `card.tsx`, `badge.tsx` | shadcn components. **The code is copied into our project**, not hidden in `node_modules`, so we can read and change it. |
| `src/pages/DashboardPage.tsx` | The `/` page: title + Welcome card. |
| `src/pages/NotFoundPage.tsx` | Shown for unknown URLs. |
| `public/favicon.svg` | Browser tab icon (served as-is). |

### How a health check travels (frontend → database)

```
HealthBadge (every 5 s)
  └─ getHealth()  →  fetch('/api/health')                     browser → localhost:5173
       └─ Vite proxy  →  http://localhost:4000/api/health      Vite → Express
            └─ pino-http logs it → healthRouter → prisma.$queryRaw`SELECT 1` → PostgreSQL
            ←  200 {db:"up"}  /  503 {db:"down"}
       ←  same response  /  if Express is down: Vite returns a non-JSON 500
  └─ setState('ok' | 'db-down' | 'offline')  →  badge re-renders
```

**Why a proxy instead of calling `http://localhost:4000` directly?**
The page comes from port 5173. A call to port 4000 is a different "origin", so the browser
would block it unless the backend sends **CORS** headers, and login cookies (Phase 1) get
complicated across origins. With the proxy, the browser only ever sees port 5173: no CORS,
and cookies just work. In production we will serve both under one domain the same way.

### Key ideas in this step

**What is middleware?**
A function that runs on every request, in order, before the route. Each one can read or
change `req`/`res`, then call `next()` to pass control on, or send a response and stop.
Logging, JSON parsing, and (later) the login check and the token check are all middleware.

**Why `.js` in imports of `.ts` files?** (e.g. `import { env } from './config/env.js'`)
With `"type": "module"` + `NodeNext`, imports must name the file **as Node will see it
after compiling**, and after `tsc` runs, `env.ts` becomes `env.js`. TypeScript understands
that `./env.js` means `./env.ts` while developing. Forgetting `.js` is the most common
error in this setup.

**Why `app.ts` and `index.ts` are separate**
`app.ts` *builds* the app; `index.ts` *runs* it. Later, tests can import `createApp()`
without starting a real server on a port.

**What the log line means**
```
[17:50:35] INFO: GET /api/health → 200 (115ms) {"req":{"id":"2f85…","method":"GET","url":"/api/health","headers":{…,"x-api-key":"[Redacted]"}},"res":{"statusCode":200},"responseTime":115}
```
time · level (INFO = 2xx, WARN = 4xx, ERROR = 5xx) · message · details. The `id`
matches the `X-Request-Id` response header, so a caller can report "request X failed"
and we can find it.

**Problems found while building (and fixed)**
1. The log said `GET /` instead of `GET /api/health`. Inside a mounted router, Express
   shortens `req.url`. Fix: use `req.originalUrl` in the log message.
2. Logs were 20+ lines per request. Fix: custom `serializers` (keep id, method, url,
   headers, status) + `singleLine: true` in pino-pretty.
3. Broken JSON was logged twice with a long stack trace. Fix: the error handler only logs
   5xx errors; pino-http already logs the 4xx line.
4. DB down printed two long stack traces. Fix: log only the short `reason`
   (`ECONNREFUSED`), and drop pino-http's generic 5xx error object (`customErrorObject`).

## 7. Folder structure

**Now (after 0.9):**
```
api-platform/
├── .git/
├── .gitignore
├── README.md
├── docs/
└── backend/
    ├── .env                    (not in Git)
    ├── .env.example
    ├── package.json
    ├── package-lock.json
    ├── prisma.config.ts
    ├── tsconfig.json
    ├── prisma/
    │   └── schema.prisma
    ├── node_modules/           (not in Git)
    └── src/
        ├── index.ts
        ├── app.ts
        ├── config/env.ts
        ├── lib/
        │   ├── logger.ts
        │   └── prisma.ts
        ├── middleware/
        │   ├── error-handler.ts
        │   └── not-found.ts
        ├── modules/
        │   └── health/health.routes.ts
        └── generated/prisma/   (not in Git)
```

**Frontend (after 0.13):**
```
frontend/
├── index.html
├── vite.config.ts
├── components.json
├── package.json / package-lock.json
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── .oxlintrc.json / .gitignore
├── public/favicon.svg
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── lib/
    │   ├── api.ts
    │   └── utils.ts
    ├── components/
    │   ├── HealthBadge.tsx
    │   ├── layout/AppLayout.tsx
    │   └── ui/ (button.tsx, card.tsx, badge.tsx)
    └── pages/
        ├── DashboardPage.tsx
        └── NotFoundPage.tsx
```

**Still to come in Phase 0:** first commit + GitHub (0.14).

## 8. How to verify manually

**Tasks 0.4–0.9 (check these now, in your own folder):**
- [ ] `npm run typecheck` prints no errors
- [ ] `npm run dev` prints `Server listening on http://localhost:4000 (development)`
- [ ] Commands #24–#30 above give the expected results
- [ ] Save any `.ts` file: the server restarts by itself

**Tasks 0.10–0.13 (check these now):**
- [ ] `npm run build` in `frontend/` ends with `✓ built`
- [ ] Tests #43–#48 above give the expected results

## 9. Common mistakes and security notes

- Forgetting `.js` at the end of relative imports gives `ERR_MODULE_NOT_FOUND`.
- Forgetting `npx prisma generate` (or `prisma.config.ts` missing) gives `Cannot find module '../generated/prisma/client.js'`.
- Putting `notFound` or `errorHandler` *before* the routes means every request becomes a 404.
- Error handler with 3 parameters instead of 4: Express treats it as normal middleware.
- Committing `.env`. Only `.env.example` goes to Git.
- Using the Postgres superuser in `DATABASE_URL`. Use the limited `api_platform` user.
- Logging secrets: anything new that may contain a secret must be added to `redact`.
- Sending stack traces to callers: they reveal file paths and library versions to attackers.
- `npm audit fix --force` may silently install a different major version. Read before running.
- Two servers on the same port gives `EADDRINUSE`. Stop one or change `PORT`.
- Running `shadcn init` before Tailwind/alias are set up: it fails its "Validating" checks.
- Adding the `@/` alias to only one place. It must be in **both** `vite.config.ts` (for running) and `tsconfig` (for type checking).
- Calling `http://localhost:4000` directly from React: CORS errors. Always use `/api/...`.
- Using `fetch` all over the components. Keep backend calls in `src/lib/api.ts`.
- Forgetting the cleanup in `useEffect` leaves timers running after the component is gone (memory leak, double polling).
- Seeing every effect run twice in development is caused by `<StrictMode>`, on purpose. It does not happen in production.

## 10. Summary

| | Items |
|---|---|
| Implemented | 0.1–0.9 backend (see above); 0.10–0.13: Vite + React 19 + TS, Tailwind v4, shadcn (Nova), React Router 8, `/api` proxy, sidebar/header layout, health badge, 404 page |
| Verified by Claude | Backend: typecheck clean; health 200/503; JSON 404/400; secrets redacted; bad env stops startup. Frontend: build passes; proxy returns health JSON; browser shows green badge → "DB down" with Postgres stopped → "Backend offline" with Express stopped |
| Verified by you | 0.1–0.9 |
| Outstanding | Your check of 0.10–0.13 in your own folder. (0.14 commit skipped by choice.) |
