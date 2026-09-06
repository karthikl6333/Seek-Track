# Seek&Track

Numbers-first trading transactions dashboard (desktop-first). Import Schwab-style CSVs, track open lots, realized & unrealized P&L by symbol/theme, run what-if P&L, and cross-check bull/bear ETF daily leverage pairs.

**Not investment advice.** This is a local ledger and calculator.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

Data persists in the browser via **IndexedDB** (survives refresh). No brokerage API.

## CSV import

Expected columns (Schwab-style):

| Column | Notes |
|--------|--------|
| Date | Trade date |
| Action | Buy, Sell, Sell Short, Buy to Cover, … |
| Symbol | Ticker |
| Description | Free text |
| Quantity | Absolute shares |
| Price | Fill price |
| Fees & Comm | Fees/commission |
| Amount | Signed cash amount (optional; estimated if blank) |

Imports are **append-only** and **idempotent**: each row is SHA-256 hashed; re-importing the same file skips duplicates and **never wipes** prior history.

Sample file: `public/sample-trades.csv` (also under `fixtures/`).

## Pair map (defaults, editable in Overview)

| ETF | Factor | Underlying | Theme |
|-----|--------|------------|-------|
| SNDQ | -2x | SNDK | SNDK family |
| MULL | +2x | MU | MU family |
| MUZ | -2x | MU | MU family |
| AVL | +2x | AVGO | AVGO family |
| AVS | -1x | AVGO | AVGO family (optional) |
| PLTZ | -2x | PLTR | PLTR family |

Themes and pairs are JSON-editable in the UI and stored in IndexedDB.

## Bull/bear cross-check caveat

The cross-check panel converts ETF % ↔ underlying % using the **daily** leverage factor.

**Approx daily-target check** — multi-day compounding diverges from a simple factor × move. Label in UI: "approx daily-target check".

## Views

1. **Overview** — stats, CSV import, theme P&L, what-if calculator, ETF cross-check, mark prices, pair/theme settings
2. **Positions** — open lots, unrealized/realized; **→ Calc** loads a position into the what-if calculator
3. **Trades** — full blotter + per-trade notes
4. **Journal** — free-form dated notes
5. **Charts** — Recharts P&L by symbol and theme

## Manual marks

Unrealized P&L uses **manual mark prices** per symbol (no live quotes).

## Stack

- TypeScript + Vite + React 18
- IndexedDB via `idb`
- Recharts

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Preview build |
