# Paper Trading API Contract

This document describes the API endpoints for the Alpaca paper trading experiment integration.

## Overview

The Paper Trading tab displays data from a separate autonomous trading agent (PaperTrade) that manages an Alpaca PAPER account. The agent should POST updates to Seek&Track via these authenticated endpoints.

**NEW: Live Refresh Feature**

The Paper tab now includes a "Refresh Live P&L" button that pulls real-time account data directly from Alpaca's paper trading API. This requires the following environment variables to be configured:

- `ALPACA_API_KEY` - Your Alpaca API key (paper account)
- `ALPACA_SECRET_KEY` - Your Alpaca secret key (paper account)

⚠️ **Important**: These credentials must be for Alpaca's **PAPER** trading account only. The refresh endpoint is hardcoded to use `https://paper-api.alpaca.markets` and will never access live trading accounts.

### Setting Environment Variables

For Cloudflare Pages/Workers deployment, set these secrets via:

```bash
wrangler pages secret put ALPACA_API_KEY --project-name=seek-track
wrangler pages secret put ALPACA_SECRET_KEY --project-name=seek-track
```

For local development, add them to your `.env` file:

```bash
ALPACA_API_KEY=your_paper_api_key_here
ALPACA_SECRET_KEY=your_paper_secret_key_here
```

## Authentication

All endpoints require HTTP Basic authentication using the same credentials configured for the Seek&Track application.

## Base URL

- **Production**: `https://seek-track.pages.dev`
- **Local Dev**: `http://localhost:3000`

## Endpoints

### 0. Refresh Live Data from Alpaca (NEW)

**Endpoint**: `POST /api/paper/refresh`

Fetches live account data directly from Alpaca's paper trading API and updates the database. This endpoint:
- Retrieves current account equity, cash, and buying power
- Fetches all open positions with live market values and unrealized P&L
- Preserves existing mandate fields (status, mandateStart, mandateEnd, strategyNote)
- Preserves position themes when updating positions

**Authentication**: Requires HTTP Basic auth (same as other endpoints)

**Request Body**: None (empty POST)

**Response (Success)**:
```json
{
  "ok": true,
  "refreshedAt": "2026-09-08T14:30:00.000Z"
}
```

**Response (Missing Credentials)**:
```json
{
  "ok": false,
  "error": "Alpaca API credentials not configured. Set ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables."
}
```
**Status**: `503 Service Unavailable`

**Response (Alpaca API Error)**:
```json
{
  "ok": false,
  "error": "Alpaca API error (401): Invalid API credentials"
}
```
**Status**: `502 Bad Gateway`

**Notes**:
- Always uses `https://paper-api.alpaca.markets` (never live trading)
- Requires `ALPACA_API_KEY` and `ALPACA_SECRET_KEY` environment variables
- UI will display a clear error message if credentials are not configured

---

### 1. Update Account State

**Endpoint**: `POST /api/paper/state`

Updates the paper trading account state including equity, cash, and P&L.

**Request Body**:
```json
{
  "equity": 100000.00,
  "cash": 50000.00,
  "buyingPower": 200000.00,
  "dayPnl": 1250.50,
  "weekPnl": 4850.75,
  "status": "active",
  "mandateStart": "2026-09-08",
  "mandateEnd": "2026-09-12",
  "strategyNote": "Levered semis / mega-cap swing"
}
```

**Fields**:
- `equity` (number, required): Total account value
- `cash` (number, required): Available cash
- `buyingPower` (number, required): Total buying power with margin
- `dayPnl` (number, required): Today's profit/loss
- `weekPnl` (number, required): Week-to-date profit/loss
- `status` (string, required): One of `"idle"`, `"active"`, or `"review"`
- `mandateStart` (string, required): Start date in `YYYY-MM-DD` format
- `mandateEnd` (string, required): End date in `YYYY-MM-DD` format
- `strategyNote` (string, required): Brief strategy description

**Response**:
```json
{
  "ok": true
}
```

---

### 2. Update Positions

**Endpoint**: `POST /api/paper/positions`

Replaces all current positions with the provided list. Send empty array to clear positions.

**Request Body**:
```json
{
  "positions": [
    {
      "symbol": "NVDA",
      "quantity": 100,
      "avgPrice": 450.25,
      "marketValue": 48500.00,
      "unrealizedPnl": 3475.00,
      "theme": "Semiconductors"
    },
    {
      "symbol": "SNDQ",
      "quantity": -50,
      "avgPrice": 22.50,
      "marketValue": -1200.00,
      "unrealizedPnl": -75.00,
      "theme": "SNDK family"
    }
  ]
}
```

**Position Fields**:
- `symbol` (string, required): Stock ticker
- `quantity` (number, required): Number of shares (negative for short positions)
- `avgPrice` (number, required): Average entry price
- `marketValue` (number, optional): Current market value
- `unrealizedPnl` (number, optional): Unrealized profit/loss
- `theme` (string, optional): Theme/sector classification

**Response**:
```json
{
  "ok": true
}
```

---

### 3. Update Orders

**Endpoint**: `POST /api/paper/orders`

Upserts orders by ID. Send recent orders; old ones will be automatically archived.

**Request Body**:
```json
{
  "orders": [
    {
      "id": "ord_abc123",
      "symbol": "NVDA",
      "side": "buy",
      "quantity": 100,
      "filledQty": 100,
      "avgFillPrice": 450.25,
      "status": "filled",
      "createdAt": "2026-09-08T14:30:00Z",
      "filledAt": "2026-09-08T14:30:05Z"
    },
    {
      "id": "ord_def456",
      "symbol": "SNDQ",
      "side": "sell short",
      "quantity": 50,
      "filledQty": 50,
      "avgFillPrice": 22.50,
      "status": "filled",
      "createdAt": "2026-09-08T15:45:00Z",
      "filledAt": "2026-09-08T15:45:03Z"
    }
  ]
}
```

**Order Fields**:
- `id` (string, required): Unique order identifier (from Alpaca)
- `symbol` (string, required): Stock ticker
- `side` (string, required): Order side (e.g., `"buy"`, `"sell"`, `"sell short"`, `"buy to cover"`)
- `quantity` (number, required): Total order quantity
- `filledQty` (number, optional): Filled quantity (default: 0)
- `avgFillPrice` (number, optional): Average fill price
- `status` (string, required): Order status (e.g., `"filled"`, `"pending"`, `"cancelled"`)
- `createdAt` (string, required): ISO 8601 timestamp
- `filledAt` (string, optional): ISO 8601 timestamp when filled

**Response**:
```json
{
  "ok": true
}
```

---

### 4. Add Journal Entry

**Endpoint**: `POST /api/paper/journal`

Records a decision journal entry explaining trade rationale.

**Request Body**:
```json
{
  "id": "journal_xyz789",
  "symbol": "NVDA",
  "note": "Entered long NVDA position. Technical breakout above $450 resistance with strong volume. Semiconductor sector showing strength."
}
```

**Fields**:
- `id` (string, required): Unique entry identifier
- `symbol` (string, optional): Associated ticker symbol
- `note` (string, required): Journal entry text

**Response**:
```json
{
  "ok": true
}
```

---

## Example Integration (Python)

```python
import requests
from datetime import datetime

BASE_URL = "https://seek-track.pages.dev"
AUTH = ("username", "password")  # HTTP Basic auth

def update_paper_state(equity, cash, buying_power, day_pnl, week_pnl):
    response = requests.post(
        f"{BASE_URL}/api/paper/state",
        json={
            "equity": equity,
            "cash": cash,
            "buyingPower": buying_power,
            "dayPnl": day_pnl,
            "weekPnl": week_pnl,
            "status": "active",
            "mandateStart": "2026-09-08",
            "mandateEnd": "2026-09-12",
            "strategyNote": "Levered semis / mega-cap swing"
        },
        auth=AUTH
    )
    return response.json()

def update_positions(positions):
    response = requests.post(
        f"{BASE_URL}/api/paper/positions",
        json={"positions": positions},
        auth=AUTH
    )
    return response.json()

def log_trade_decision(symbol, note):
    response = requests.post(
        f"{BASE_URL}/api/paper/journal",
        json={
            "id": f"journal_{int(datetime.now().timestamp())}",
            "symbol": symbol,
            "note": note
        },
        auth=AUTH
    )
    return response.json()
```

## Notes

- All endpoints are idempotent and can be called repeatedly
- Positions are completely replaced on each POST (not merged)
- Orders are upserted by ID (updates existing, creates new)
- Journal entries are upserted by ID
- The dashboard auto-refreshes from the database
- No real-time WebSocket required; POST updates as needed (e.g., after each trade or on a schedule)
