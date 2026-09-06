# Seek&Track

Numbers-first trading transactions dashboard (desktop-first). Import Schwab-style CSVs, track open lots, realized & unrealized P&L by symbol/theme, run what-if P&L, and cross-check bull/bear ETF daily leverage pairs.

**Not investment advice.** This is a ledger and calculator with Postgres persistence.

## Quick start (local)

```bash
cp .env.example .env
npm install
```

Start Postgres (requires Docker):

```bash
npm run db:up
```

If Docker is unavailable, set `DATABASE_URL` in `.env` to any reachable Postgres instance.

Run the API + Vite together:

```bash
npm run dev
```

Open Vite at `http://localhost:5173` (proxies `/api` to the API on `:3000`).

### Full stack via Compose

```bash
docker compose up --build
```

Then open `http://localhost:3000`.

### Production build

```bash
npm run build
npm start
```

Requires `DATABASE_URL` in the environment.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (prod/API) | Postgres connection string |
| `PORT` | No | API listen port (default `3000`; Render sets this) |
| `PGSSL` | No | Set to `true` to enable SSL for managed Postgres |
| `VITE_API_BASE` | No | Frontend API prefix (default empty = same origin) |

Copy `.env.example` to `.env` for local development. The API runs schema migration/`ensureSchema` on boot.

## Deploy (Render)

This repo includes `render.yaml`:

1. Push to GitHub and create a new Blueprint on Render from the repo.
2. Render provisions a free Postgres DB and free web service.
3. `DATABASE_URL` is injected automatically; `PGSSL=true` is set for managed Postgres.

Alternatively, use Docker Compose on any host (`docker compose up --build`).

## CSV import

Expected columns (Schwab-style): Date, Action, Symbol, Description, Quantity, Price, Fees & Comm, Amount.

Imports are **append-only** and **idempotent**: each row is SHA-256 hashed (`row_hash`); re-importing skips duplicates via `ON CONFLICT (row_hash) DO NOTHING`.

Sample file: `public/sample-trades.csv` (also under `fixtures/`).

## API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | Liveness |
| GET/POST | `/api/trades` | List / append trades |
| PATCH | `/api/trades/:id` | Update note |
| POST | `/api/import` | `{ csvText }` server-side parse + import |
| GET/PUT | `/api/marks` | Mark prices |
| GET/POST/DELETE | `/api/journal` | Journal entries |
| GET/PUT | `/api/settings` | Pair map / themes JSON |

No auth (public URL for now).

## Stack

- TypeScript + Vite + React 18
- Hono API (`server/`) + Postgres (`pg`)
- Recharts (client-side analytics)

## Scripts

| Script | Purpose |
|--------|---------|
| `dev` | Vite + API (tsx watch), proxy `/api` |
| `build` | Client + server production build |
| `start` | Serve API + static `dist/` |
| `db:up` | Start Postgres via Compose |

## Pair map (defaults, editable in Overview)

| ETF | Factor | Underlying | Theme |
|-----|--------|------------|-------|
| SNDQ | -2x | SNDK | SNDK family |
| MULL | +2x | MU | MU family |
| MUZ | -2x | MU | MU family |
| AVL | +2x | AVGO | AVGO family |
| AVS | -1x | AVGO | AVGO family (optional) |
| PLTZ | -2x | PLTR | PLTR family |

## Bull/bear cross-check caveat

The cross-check panel converts ETF % ↔ underlying % using the **daily** leverage factor.

**Approx daily-target check** — multi-day compounding diverges from a simple factor × move.
