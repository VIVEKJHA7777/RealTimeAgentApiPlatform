# Realtime API Platform

A multi-tenant platform where brands upload product data and expose it as realtime
APIs in the Jivox "contract/1" format.

- **Start here (current state, decisions, how to continue): [docs/HANDOFF.md](docs/HANDOFF.md)**
- Plan and scope: [docs/ROADMAP.md](docs/ROADMAP.md)
- Phase notes: [docs/phases/](docs/phases/)

## Requirements

- Node.js 20+ (tested with 22)
- PostgreSQL (local Homebrew install, port 5432)

## Folder layout

```
backend/    Express + TypeScript + Prisma API server (port 4000)
frontend/   React + Vite + Tailwind + shadcn website (port 5173)
docs/       Plan, roadmap and per-phase notes
```

## Run locally

### Backend

```bash
cd backend
cp .env.example .env        # then fill in real values
npm install
npx prisma generate         # builds the database client
npm run dev                 # http://localhost:4000
```

Check: `curl localhost:4000/api/health` → `{"status":"ok","db":"up",...}`

### Frontend

Run in a second terminal (the backend must be running too):

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Open http://localhost:5173 → sign up or log in. The badge in the top-right shows whether the backend and database are up.
