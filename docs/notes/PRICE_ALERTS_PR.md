# Price Tracking Alert System for Seek&Track

## Overview

This PR implements a complete price alert system that allows users to configure price alerts for positions, manage them from an "Alert Manager" tile, and add alerts directly from What-If calculators.

## Features

### 1. Alert Manager Tile (Overview Page)

- **Location**: Right sidebar of Overview page, between Watchlist and CSV Import
- **Functionality**:
  - Lists all configured price alerts (symbol, target price, condition, status)
  - Shows active vs triggered alerts
  - Add new alerts with symbol picker (autocomplete from positions + watchlist)
  - Delete alerts
  - Status badges: Active (gray) or Triggered (green with last price)

### 2. What-If Calculator Integration

- **Add Alert Button**: Appears when symbol and target price are set
- **One-Click Creation**: Prefills alert with calculator's symbol and target price
- **Available on Both Calculators**: Works on Calculator A and Calculator B

### 3. Alert Evaluation & Notifications

- **Auto-Evaluation**: Runs after every quote refresh (30-second intervals in Node.js)
- **Conditions**: 
  - "Price crosses above" (≥ target)
  - "Price drops below" (≤ target)
- **One-Shot Triggers**: Alerts fire once, then status changes to "triggered"
- **No Spam**: Debounced by status (won't re-fire on subsequent ticks)

### 4. Dual-Channel Notifications

When an alert triggers:

#### Email Notification
- **Via Resend API**: Professional HTML + plain text email
- **Fallback**: Console logging if RESEND_API_KEY not configured
- **Content**: Symbol, condition, target price, last price, timestamp (IST)
- **Styled HTML**: Modern, responsive email template

#### Webhook Notification
- **POST JSON** to configured webhook URL
- **Payload**:
  ```json
  {
    "symbol": "NVDA",
    "target": 150.00,
    "direction": "above",
    "lastPrice": 150.25,
    "firedAt": "2026-10-01T06:30:00.000Z"
  }
  ```
- **Use Case**: Integration with Chief (desk bot) or other alerting systems

## Data Model

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  target_price DOUBLE PRECISION NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_at TIMESTAMPTZ,
  last_price DOUBLE PRECISION,
  notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS price_alerts_symbol_idx ON price_alerts (symbol);
CREATE INDEX IF NOT EXISTS price_alerts_status_idx ON price_alerts (status);
CREATE INDEX IF NOT EXISTS price_alerts_created_idx ON price_alerts (created_at DESC);
```

### API Endpoints

- `GET /api/alerts` - List all alerts (excludes deleted)
- `POST /api/alerts` - Create new alert
  ```json
  {
    "symbol": "NVDA",
    "targetPrice": 150.00,
    "condition": "above"
  }
  ```
- `DELETE /api/alerts/:id` - Soft delete an alert
- `POST /api/alerts/evaluate` - Manual trigger for alert evaluation (auto-runs on quote refresh)

## Environment Variables

Add these to your `.env` file (all optional):

```bash
# Email notifications (Resend)
ALERT_EMAIL_TO=karthik@example.com
RESEND_API_KEY=re_your_resend_api_key_here
ALERT_EMAIL_FROM=alerts@yourdomain.com

# Webhook notifications (Chief / desk bot)
ALERT_WEBHOOK_URL=https://your-chief-bot.com/alerts
```

### Configuration Notes

1. **Email**: Requires Resend API key ([resend.com](https://resend.com) - free tier: 100 emails/day)
2. **Webhook**: Any HTTPS endpoint that accepts JSON POST
3. **Both Optional**: System works without notifications (alerts still track in UI)

## Testing Locally

1. **Start the database**:
   ```bash
   npm run db:up
   ```

2. **Set environment variables** (optional):
   ```bash
   export ALERT_EMAIL_TO=your-email@example.com
   export RESEND_API_KEY=re_your_key
   export ALERT_WEBHOOK_URL=https://webhook.site/your-unique-url
   ```

3. **Run dev server**:
   ```bash
   npm run dev
   ```

4. **Create an alert**:
   - Go to Overview page
   - Scroll to "Price Alerts" tile in right sidebar
   - Click "+ Add alert"
   - Enter symbol (e.g., NVDA), target price, and condition
   - Click "Add Alert"

5. **Test from Calculator**:
   - Load a position into Calculator A or B
   - Set a target price
   - Click "🔔 Add alert @ $XXX.XX" button

6. **Trigger evaluation**:
   - Wait for auto-refresh (30 seconds)
   - OR click "↻ Refresh prices" in Holdings table
   - OR manually POST to `/api/alerts/evaluate`

7. **Check notifications**:
   - **Email**: Check inbox if Resend configured
   - **Webhook**: Check webhook.site or your endpoint logs
   - **Console**: `docker compose logs -f api` (look for `[Alerts]` lines)
   - **UI**: Alert status changes to "Triggered" with last price

## Testing on Cloudflare Pages (Production)

After deployment to `seek-track.pages.dev`:

1. **Configure secrets** in Cloudflare dashboard:
   - `ALERT_EMAIL_TO`
   - `RESEND_API_KEY`
   - `ALERT_EMAIL_FROM` (optional)
   - `ALERT_WEBHOOK_URL` (optional)

2. **Create test alerts** via UI

3. **Monitor**: Check Cloudflare Workers logs for `[Alerts]` entries

## Architecture Decisions

### Why Resend for Email?
- Simple HTTP API (no SMTP complexity)
- Works in Cloudflare Workers
- Free tier sufficient for most users
- Production-grade deliverability
- Alternative: User can integrate Gmail MCP via separate automation

### Why Webhook + Email?
- Email: Human-readable notifications
- Webhook: Machine-readable for Chief/bots
- Both fire simultaneously
- Both are optional (alerts work without)

### Why One-Shot Triggers?
- Prevents notification spam
- Clear semantics: alert fires once at crossing
- User can recreate alert for recurring checks
- Future enhancement: add "recurring" option

### Why Evaluate on Quote Refresh?
- Reuses existing quote infrastructure
- No new polling/cron needed
- Alerts evaluate within seconds of price update
- Scales with existing quote service

## Future Enhancements

1. **Recurring Alerts**: Option to re-arm after trigger
2. **Alert History**: Track all triggers over time
3. **Alert Templates**: Save common alert patterns
4. **Bulk Import**: CSV upload for multiple alerts
5. **Conditional Alerts**: "If NVDA > 150 AND MU > 100"
6. **Time-Based**: "Only alert during market hours"
7. **Mobile Push**: Native mobile app notifications
8. **SMS**: Twilio integration

## File Changes

### New Files
- `server/alerts.ts` - Alert CRUD + evaluation + notifications
- `src/components/AlertManager.tsx` - Alert Manager UI component
- `PRICE_ALERTS_PR.md` - This document

### Modified Files
- `server/schema.sql` - Added `price_alerts` table
- `server/index.ts` - Added alert routes
- `server/quote-service.ts` - Added alert evaluation after quote refresh
- `src/components/Overview.tsx` - Added AlertManager, handleAddAlert callback
- `src/components/Calculator.tsx` - Added "Add alert" button + onAddAlert prop
- `src/lib/db.ts` - Added alert API functions
- `src/types/index.ts` - Added PriceAlert interface
- `.env.example` - Documented alert environment variables

## Breaking Changes

None. This is purely additive.

## Deployment Checklist

- [x] Schema migration automatic (ensureSchema on boot)
- [x] Backward compatible (alerts optional)
- [x] TypeScript build passes
- [x] No breaking changes to existing features
- [ ] Configure Resend API key (optional, for email)
- [ ] Configure webhook URL (optional, for Chief)
- [ ] Set ALERT_EMAIL_TO recipient

## Screenshots / Demo

After deployment, test by:
1. Creating an alert for a volatile symbol (e.g., NVDA)
2. Setting target slightly above/below current price
3. Waiting for next quote refresh
4. Checking email/webhook/UI for triggered alert

---

**Resolves**: User request for price tracking alert system with email + webhook notifications
