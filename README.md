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

## Live prices

- Yahoo Finance chart quotes (no API key) persist to `marks`; server cron + client poll every 15 minutes.
- `POST /api/quotes/refresh`. Fallback: manual marks if Yahoo fails.

## Dynamic pair map

Seeds (SNDQ/MULL/...) are cache only. Resolve via seeds -> `pair_cache` -> Yahoo name parse (best-effort). Override in Pair Map / `PUT /api/pairs`.

## Manual fills

Overview **Add to existing positions** -> `POST /api/trades` with `source=manual`.

## CSV import

Expected columns (Schwab-style): Date, Action, Symbol, Description, Quantity, Price, Fees & Comm, Amount.

Identical CSV rows are still **deduped by `row_hash`**. Default import mode: **Re-import overrides conflicting manual trades for symbols in this file** (toggle default ON): deletes `source=manual` rows for symbols present in the CSV, then inserts new CSV rows.

Sample file: `public/sample-trades.csv` (also under `fixtures/`).

## API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | Liveness |
| GET/POST | `/api/trades` | List / append or manual fill |
| PATCH | `/api/trades/:id` | Update note |
| POST | `/api/import` | `{ csvText, overrideManual? }` |
| GET/PUT | `/api/marks` | Marks (`?detailed=1`)
| GET/POST | `/api/quotes/refresh` | Yahoo -> marks |
| GET | `/api/pairs` | Cached pairs |
| GET | `/api/pairs/resolve?symbol=` | Resolve pair |
| PUT | `/api/pairs` | Override pair |
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

## Pair map seeds (defaults; not an allow-list)

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
