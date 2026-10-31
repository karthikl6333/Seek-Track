# Paper Flex API Documentation

## Overview

The Paper Flex API provides a second Alpaca paper trading account integration for Seek&Track, parallel to the existing Paper API. This enables PaperTrade to manage multiple paper trading strategies simultaneously.

## Account Configuration

**FLEX-STK / A1** is the second stock paper trading account with these characteristics:

- **Account Name**: FLEX-STK / A1 ORB-DAY-ETF
- **Initial Capital (t0)**: $200,000
- **Alpaca Paper Account**: PA3BQ3UKAB7D
- **Strategy**: ORB-DAY-ETF (Opening Range Breakout Day Trading ETFs)

## Environment Variables

Configure these environment variables in your deployment environment (Cloudflare Workers secrets or similar):

```bash
ALPACA_FLEX_API_KEY=<your-flex-api-key>
ALPACA_FLEX_SECRET_KEY=<your-flex-secret-key>
```

**Important**: These credentials are separate from the existing `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` used by the standard Paper account (CTRL-LRS / S0).

## Database Schema

The Paper Flex implementation uses parallel database tables to the existing paper trading tables:

### Tables

- `paper_flex_state`: Account equity, cash, buying power, P&L, status
- `paper_flex_positions`: Open positions with unrealized P&L
- `paper_flex_orders`: Order history and fills
- `paper_flex_journal`: Notes and observations

### Total P&L Calculation

Total P&L is computed as:

```
totalPnl = equity_now - t0_equity
```

Where:
- `equity_now`: Current account equity from Alpaca API
- `t0_equity`: Initial capital (stored in `paper_flex_state.t0_equity`, default $200,000)

The `t0_equity` value is preserved across refreshes and can be adjusted manually if needed for reset scenarios.

## API Endpoints

All Paper Flex endpoints are under the `/api/paper-flex` namespace:

### GET /api/paper-flex

Retrieve current Paper Flex account summary.

**Response:**
```json
{
  "state": {
    "equity": 200000,
    "cash": 200000,
    "buyingPower": 400000,
    "dayPnl": 0,
    "weekPnl": 0,
    "t0Equity": 200000,
    "status": "active",
    "mandateStart": "2026-09-08",
    "mandateEnd": "2026-09-12",
    "strategyNote": "FLEX-STK / A1 ORB-DAY-ETF",
    "updatedAt": "2026-09-17T06:00:00.000Z"
  },
  "positions": [],
  "recentOrders": [],
  "journalEntries": [],
  "scoreboard": {
    "totalPnl": 0,
    "tradeCount": 0,
    "winRate": null
  }
}
```

### POST /api/paper-flex/refresh

Refresh live P&L data from Alpaca paper API. Fetches current account equity, cash, buying power, and open positions from Alpaca and updates the database.

**Response:**
```json
{
  "ok": true,
  "refreshedAt": "2026-09-17T06:00:00.000Z"
}
```

**Error Response (503 - Missing Credentials):**
```json
{
  "ok": false,
  "error": "Alpaca FLEX API credentials not configured. Set ALPACA_FLEX_API_KEY and ALPACA_FLEX_SECRET_KEY environment variables."
}
```

### POST /api/paper-flex/state

Update Paper Flex account state (for external trading agents).

**Request Body:**
```json
{
  "equity": 205000,
  "cash": 180000,
  "buyingPower": 360000,
  "dayPnl": 5000,
  "weekPnl": 5000,
  "status": "active",
  "mandateStart": "2026-09-08",
  "mandateEnd": "2026-09-12",
  "strategyNote": "FLEX-STK / A1 ORB-DAY-ETF"
}
```

### POST /api/paper-flex/positions

Bulk upsert positions (replaces all existing positions).

**Request Body:**
```json
{
  "positions": [
    {
      "symbol": "SOXL",
      "quantity": 100,
      "avgPrice": 45.50,
      "marketValue": 4600,
      "unrealizedPnl": 50,
      "theme": "Semis Bull"
    }
  ]
}
```

### POST /api/paper-flex/orders

Upsert orders (individual order updates).

**Request Body:**
```json
{
  "orders": [
    {
      "id": "order-123",
      "symbol": "SOXL",
      "side": "buy",
      "quantity": 100,
      "filledQty": 100,
      "avgFillPrice": 45.50,
      "status": "filled",
      "createdAt": "2026-09-17T06:00:00.000Z",
      "filledAt": "2026-09-17T06:00:10.000Z"
    }
  ]
}
```

### POST /api/paper-flex/journal

Add journal entry for notes and observations.

**Request Body:**
```json
{
  "id": "journal-entry-123",
  "symbol": "SOXL",
  "note": "Entered on ORB breakout above 45.00"
}
```

## UI Integration

The Paper Flex account is accessible through:

1. **Paper Flex Tab**: Full view with account state, positions, orders, and scoreboard
2. **Overview Page**: Tile showing Total P&L and current equity (clickable to Paper Flex tab)
3. **Global Refresh**: The topbar refresh button refreshes all three paper accounts (Paper, Paper Flex, Crypto)

## Differences from Standard Paper Account

| Feature | Paper (CTRL-LRS) | Paper Flex (FLEX-STK) |
|---------|------------------|------------------------|
| Account | PA36BIVXO413 | PA3BQ3UKAB7D |
| Initial Capital | $100,000 | $200,000 |
| Strategy | Levered semis / mega-cap swing | ORB-DAY-ETF |
| API Keys | `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` | `ALPACA_FLEX_API_KEY` / `ALPACA_FLEX_SECRET_KEY` |
| API Namespace | `/api/paper` | `/api/paper-flex` |
| DB Tables | `paper_*` | `paper_flex_*` |
| UI Label | "Paper" / "CTRL-LRS" | "Paper Flex" / "FLEX-STK / A1" |

## Deployment Notes for HostOps

1. **Add Secrets** to Cloudflare Workers:
   ```bash
   npx wrangler secret put ALPACA_FLEX_API_KEY
   npx wrangler secret put ALPACA_FLEX_SECRET_KEY
   ```

2. **Database Migration**: The schema changes are backward-compatible and use `IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so existing deployments will upgrade automatically on next schema run.

3. **No Breaking Changes**: Existing Paper and Crypto Paper accounts continue to work unchanged.

## PaperTrade Integration

PaperTrade agents can use the same posting patterns as the existing Paper account:

1. Fetch live account state: `GET /api/paper-flex`
2. After executing trades via Alpaca, refresh from API: `POST /api/paper-flex/refresh`
3. Optionally post journal entries for trade rationale: `POST /api/paper-flex/journal`

The Total P&L calculation (`equity - t0_equity`) ensures accurate cumulative performance tracking even if the account is reset or adjusted.
