# Crypto Paper Trading API Contract

This document describes the API endpoints for the Alpaca paper trading experiment integration **for crypto-only trading**.

## Overview

The Crypto Paper Trading tab displays data from a separate autonomous trading agent (CryptoTrade) that manages an Alpaca PAPER account **restricted to cryptocurrency assets only**. The agent should POST updates to Seek&Track via these authenticated endpoints.

## Authentication

All endpoints require HTTP Basic authentication using the same credentials configured for the Seek&Track application.

## Base URL

- **Production**: `https://seek-track.pages.dev`
- **Local Dev**: `http://localhost:3000`

## Environment Variables

The crypto paper trading feature uses **separate** Alpaca API credentials from the stock paper trading feature:

- `ALPACA_CRYPTO_API_KEY` - Alpaca paper trading API key for crypto-only account
- `ALPACA_CRYPTO_SECRET_KEY` - Alpaca paper trading secret key for crypto-only account

These must be configured in the Cloudflare Pages environment variables or local `.env` file.

## Endpoints

### 1. Get Crypto Paper Summary

**Endpoint**: `GET /api/crypto-paper`

Returns the complete crypto paper trading state including account metrics, positions, orders, journal, and scoreboard.

**Response**:
```json
{
  "state": {
    "equity": 100000.00,
    "cash": 50000.00,
    "buyingPower": 200000.00,
    "dayPnl": 1250.50,
    "weekPnl": 4850.75,
    "status": "active",
    "mandateStart": "2026-09-08",
    "mandateEnd": "2026-09-12",
    "strategyNote": "Crypto-only paper trading",
    "updatedAt": "2026-09-08T14:30:00Z"
  },
  "positions": [...],
  "recentOrders": [...],
  "journalEntries": [...],
  "scoreboard": {
    "totalPnl": 4850.75,
    "tradeCount": 15,
    "winRate": 0.6667
  }
}
```

---

### 2. Update Account State

**Endpoint**: `POST /api/crypto-paper/state`

Updates the crypto paper trading account state including equity, cash, and P&L.

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
  "strategyNote": "Crypto-only paper trading"
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

### 3. Update Positions

**Endpoint**: `POST /api/crypto-paper/positions`

Replaces all current crypto positions with the provided list. Send empty array to clear positions.

**Request Body**:
```json
{
  "positions": [
    {
      "symbol": "BTCUSD",
      "quantity": 0.5,
      "avgPrice": 45000.25,
      "marketValue": 23500.00,
      "unrealizedPnl": 1000.00,
      "theme": "Bitcoin"
    },
    {
      "symbol": "ETHUSD",
      "quantity": 10,
      "avgPrice": 2500.50,
      "marketValue": 26000.00,
      "unrealizedPnl": 950.00,
      "theme": "Ethereum"
    }
  ]
}
```

**Position Fields**:
- `symbol` (string, required): Crypto ticker (e.g., `BTCUSD`, `ETHUSD`)
- `quantity` (number, required): Number of units (crypto supports fractional quantities)
- `avgPrice` (number, required): Average entry price
- `marketValue` (number, optional): Current market value
- `unrealizedPnl` (number, optional): Unrealized profit/loss
- `theme` (string, optional): Theme/category classification (e.g., "Bitcoin", "Ethereum", "DeFi")

**Response**:
```json
{
  "ok": true
}
```

---

### 4. Update Orders

**Endpoint**: `POST /api/crypto-paper/orders`

Upserts crypto orders by ID. Send recent orders; old ones will be automatically archived.

**Request Body**:
```json
{
  "orders": [
    {
      "id": "ord_crypto_abc123",
      "symbol": "BTCUSD",
      "side": "buy",
      "quantity": 0.5,
      "filledQty": 0.5,
      "avgFillPrice": 45000.25,
      "status": "filled",
      "createdAt": "2026-09-08T14:30:00Z",
      "filledAt": "2026-09-08T14:30:05Z"
    },
    {
      "id": "ord_crypto_def456",
      "symbol": "ETHUSD",
      "side": "buy",
      "quantity": 10,
      "filledQty": 10,
      "avgFillPrice": 2500.50,
      "status": "filled",
      "createdAt": "2026-09-08T15:45:00Z",
      "filledAt": "2026-09-08T15:45:03Z"
    }
  ]
}
```

**Order Fields**:
- `id` (string, required): Unique order identifier (from Alpaca)
- `symbol` (string, required): Crypto ticker
- `side` (string, required): Order side (e.g., `"buy"`, `"sell"`)
- `quantity` (number, required): Total order quantity (fractional allowed)
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

### 5. Add Journal Entry

**Endpoint**: `POST /api/crypto-paper/journal`

Records a decision journal entry explaining crypto trade rationale.

**Request Body**:
```json
{
  "id": "journal_crypto_xyz789",
  "symbol": "BTCUSD",
  "note": "Entered long BTC position. Technical breakout above $45k resistance with strong volume. Bitcoin showing strength."
}
```

**Fields**:
- `id` (string, required): Unique entry identifier
- `symbol` (string, optional): Associated crypto ticker symbol
- `note` (string, required): Journal entry text

**Response**:
```json
{
  "ok": true
}
```

---

### 6. Refresh Live P&L from Alpaca

**Endpoint**: `POST /api/crypto-paper/refresh`

Pulls live account state and positions from the Alpaca paper API using `ALPACA_CRYPTO_API_KEY` and `ALPACA_CRYPTO_SECRET_KEY`. This endpoint automatically updates the crypto paper state and positions tables.

**Request Body**: None (empty POST)

**Response (Success)**:
```json
{
  "ok": true,
  "refreshedAt": "2026-09-08T16:00:00Z",
  "equity": 100000.00,
  "cash": 50000.00,
  "positions": 2
}
```

**Response (Error)**:
```json
{
  "ok": false,
  "error": "ALPACA_CRYPTO_API_KEY and ALPACA_CRYPTO_SECRET_KEY environment variables required"
}
```

**Notes**:
- This endpoint requires `ALPACA_CRYPTO_API_KEY` and `ALPACA_CRYPTO_SECRET_KEY` to be configured
- Uses Alpaca's paper trading API: `https://paper-api.alpaca.markets`
- Automatically updates both account state and positions
- Returns 500 status code on error with error message

---

## Example Integration (Python)

```python
import requests
from datetime import datetime

BASE_URL = "https://seek-track.pages.dev"
AUTH = ("username", "password")  # HTTP Basic auth

def update_crypto_paper_state(equity, cash, buying_power, day_pnl, week_pnl):
    response = requests.post(
        f"{BASE_URL}/api/crypto-paper/state",
        json={
            "equity": equity,
            "cash": cash,
            "buyingPower": buying_power,
            "dayPnl": day_pnl,
            "weekPnl": week_pnl,
            "status": "active",
            "mandateStart": "2026-09-08",
            "mandateEnd": "2026-09-12",
            "strategyNote": "Crypto-only paper trading"
        },
        auth=AUTH
    )
    return response.json()

def update_crypto_positions(positions):
    response = requests.post(
        f"{BASE_URL}/api/crypto-paper/positions",
        json={"positions": positions},
        auth=AUTH
    )
    return response.json()

def log_crypto_trade_decision(symbol, note):
    response = requests.post(
        f"{BASE_URL}/api/crypto-paper/journal",
        json={
            "id": f"journal_crypto_{int(datetime.now().timestamp())}",
            "symbol": symbol,
            "note": note
        },
        auth=AUTH
    )
    return response.json()

def refresh_crypto_live_pnl():
    response = requests.post(
        f"{BASE_URL}/api/crypto-paper/refresh",
        auth=AUTH
    )
    return response.json()
```

---

## Data Isolation

The crypto paper trading feature uses **separate database tables** from the stock paper trading feature:

- Stock Paper: `paper_state`, `paper_positions`, `paper_orders`, `paper_journal`
- Crypto Paper: `crypto_paper_state`, `crypto_paper_positions`, `crypto_paper_orders`, `crypto_paper_journal`

This ensures complete data isolation between stock and crypto paper trading experiments.

---

## Notes

- All endpoints are idempotent and can be called repeatedly
- Positions are completely replaced on each POST (not merged)
- Orders are upserted by ID (updates existing, creates new)
- Journal entries are upserted by ID
- The dashboard auto-refreshes from the database
- No real-time WebSocket required; POST updates as needed (e.g., after each trade or on a schedule)
- The `/api/crypto-paper/refresh` endpoint uses **separate** credentials (`ALPACA_CRYPTO_API_KEY` / `ALPACA_CRYPTO_SECRET_KEY`) from stock paper trading
- Crypto positions support fractional quantities (e.g., 0.5 BTC)
