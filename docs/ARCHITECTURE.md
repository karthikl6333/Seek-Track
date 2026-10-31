# Architecture

Seek&Track is a Vite/React client plus a Hono API. The same Hono app runs on **Cloudflare Pages
(Workers + D1)** in production and on **Node (Neon/Postgres or D1-compatible)** locally.

## Server (`server/`)

Code is grouped by domain. `server/index.ts` only builds the Hono app, calls `registerApi(app)`,
starts the Workers research cron, and (in Node) runs `main()`.

| Dir | Contents |
|-----|----------|
| `routes/` | HTTP layer, one file per domain (`system`, `portfolio`, `quotes`, `research`, `paper`, `plan`) plus `middleware.ts` (auth, headers) and `index.ts` (`registerApi`, registers middleware first, then routes). `routes.test.ts` pins the route table and ordering. |
| `core/` | Cross-cutting infrastructure: `auth`, `hash`, `isolate-cache`, `read-budget` (D1 read-budget caches), `schema-version` (schema gate). |
| `quotes/` | Quote fetching/refresh, SSE stream, alerts, watchlist, market hours, pair definitions. |
| `portfolio/` | Trades, CSV importer (incl. Margin Interest rows), journal, settings. |
| `paper/` | Alpaca paper trading (stocks, flex, crypto). `shared.ts` holds helpers and Alpaca types shared by the three. |
| `research/` | Research universe, discovery, Yahoo access, summary and `handlers.ts` (route handlers). |
| `plan/` | Plan rules, notifications, seeds. |
| `static.ts` | Static asset serving for Node mode. |

### Files that must stay at the `server/` root

- `index.ts`, `db.ts`: `scripts/prepare-cf-pages.js` imports `dist-server/index.js` and `dist-server/db.js`.
- `schema.sql`, `schema-d1.sql`: read by `scripts/prepare-cf-pages.js`; `build:server` copies `schema.sql` to the `dist-server` root.
- `db-d1.ts`, `db-neon.ts`: in Node mode they look up `schema*.sql` relative to their own directory.

### Schema gate

`core/schema-version.ts` holds `SCHEMA_VERSION` (currently 3) and a hash of `schema-d1.sql`.
`schema-version.test.ts` fails if the schema changes without bumping the version
(the previous schema is kept in `core/fixtures/`). Schema changes need a version bump and a
migration; never edit the schema silently.

### Read-budget caches

D1 reads are billed, so hot reads (trades, marks, settings) are cached per isolate via
`core/isolate-cache.ts` / `core/read-budget.ts`. Writers pass `fresh` / invalidate so a cached copy
can't hide a write.

## Client (`src/`)

| Dir | Contents |
|-----|----------|
| `api/` | `client.ts`: the typed API client (auth errors, trades, marks, settings, ...). `http.ts`: small `apiGet`/`apiSend` helpers used by Research and Watchlist. |
| `app/` | Shell: `Sidebar`, `Topbar`, `StatusScreens`, `nav` (tab definitions), `logout`. |
| `pages/` | One folder per tab: `overview` (Overview, Watchlist, Calculator, CSV import, alerts, plan vs price), `positions`, `trades`, `charges`, `charts`, `research` (page plus types, sector themes, format helpers, cards), `paper` (Paper, PaperFlex, CryptoPaper). |
| `components/` | Shared UI: `TickerLink`, `FilterChips`. |
| `hooks/` | `useStore` (data), `useLiveQuotes` / `useMarksStream` / `useLiveQuotesToggle` (SSE prices), `useRefreshScheduler` (timed refresh), `usePaperSync`. |
| `lib/` | Pure logic with tests: FIFO lots/P&L (`lots`), charges, formatting, market hours and holidays (`marketHours`, `pollGate`), marks merging, `chunkedRefresh`, `refreshStamp`. |
| `types/` | Shared TypeScript types. |

### Price refresh behavior (unchanged by the refactor)

Driven by `hooks/useRefreshScheduler.ts` using `lib/marketHours.ts` / `lib/pollGate.ts`:
30 s regular session, 60 s pre/after-hours, 10 min when closed on weekdays, no automatic refresh from
Fri 20:00 ET to Mon 04:00 ET and on NYSE holidays. Manual refresh always works. Prices are never
shown blank: the last known mark is kept when a refresh fails or a symbol has no new quote.

## Commands

- `npm run build`: client + server type-check/build.
- `npm run build:cf`: the above plus `scripts/prepare-cf-pages.js` (Cloudflare Pages bundle in `dist-cf`).
- `CI=1 npm test -- --run`: Vitest suite (client `src/**` and server `server/**`).

Historic implementation notes live in `docs/notes/`.
