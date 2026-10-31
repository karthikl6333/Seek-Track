# Price Alert System - Testing Guide

## Quick Start

### Prerequisites
- Seek&Track running locally or deployed
- Database initialized (schema auto-migrates)
- Optional: Resend API key for email testing
- Optional: Webhook endpoint for webhook testing

## Test Scenarios

### Scenario 1: Create Alert via Alert Manager

1. **Navigate to Overview**
   - Open Seek&Track in browser
   - You should see "Price Alerts" tile in the right sidebar

2. **Add Alert**
   - Click "+ Add alert" button
   - Fill in form:
     - **Symbol**: NVDA (or any symbol from your holdings/watchlist)
     - **Target Price**: Set slightly above/below current price
     - **Condition**: "Price crosses above" or "Price drops below"
   - Click "Add Alert"
   - You should see: Success message, alert appears in table

3. **Verify UI**
   - Alert shows in table with:
     - Symbol: NVDA
     - Target: Your target price
     - Condition: "crosses above" or "drops below"
     - Status: "Active" (gray badge)
   - Bottom stats show: "Active alerts: 1 · Triggered: 0"

### Scenario 2: Create Alert from Calculator

1. **Load Position into Calculator**
   - Go to Overview → Holdings table
   - Click "→ A" button on any position row
   - Calculator A populates with that position

2. **Set Target Price**
   - In Calculator A, enter a target price
   - You should see: "🔔 Add alert @ $XXX.XX" button appears

3. **Create Alert**
   - Click the "🔔 Add alert" button
   - You should see: Alert created popup, Alert Manager updates

4. **Verify**
   - Check Alert Manager tile
   - New alert should appear with calculator's symbol and target

### Scenario 3: Trigger Alert (Email + Webhook)

#### Setup
```bash
# Set environment variables
export ALERT_EMAIL_TO=your-email@example.com
export RESEND_API_KEY=re_your_resend_api_key
export ALERT_WEBHOOK_URL=https://webhook.site/your-unique-url
export ALERT_EMAIL_FROM=alerts@yourdomain.com
```

#### Test
1. **Create Alert Near Current Price**
   - Add alert for NVDA
   - Set target 0.1% above/below current price
   - Choose appropriate condition

2. **Trigger Quote Refresh**
   - Option A: Wait 30 seconds (auto-refresh)
   - Option B: Click "↻ Refresh prices" in Holdings table
   - Option C: POST to `/api/alerts/evaluate` endpoint

3. **Verify Trigger**
   - **UI**: Alert status changes to "Triggered" (green badge) with last price
   - **Email**: Check inbox for alert email
   - **Webhook**: Check webhook.site for POST data
   - **Console**: Search logs for `[Alerts] Triggered`

#### Expected Email
```
Subject: 🚨 Price Alert: NVDA crossed above 150.00

Body (HTML):
- Professional gradient header
- Symbol, condition, target, last price
- IST timestamp
- "Triggered by Seek&Track" footer
```

#### Expected Webhook
```json
POST https://webhook.site/your-unique-url
{
  "symbol": "NVDA",
  "target": 150.00,
  "direction": "above",
  "lastPrice": 150.25,
  "firedAt": "2026-10-01T06:30:00.000Z"
}
```

### Scenario 4: Delete Alert

1. **Navigate to Alert Manager**
   - View your alerts in the table

2. **Delete**
   - Click "Delete" button on any alert
   - Confirm deletion dialog
   - Alert disappears from table

3. **Verify**
   - Alert no longer appears in UI
   - Database: `status='deleted'` (soft delete)

### Scenario 5: No Spam Test

1. **Create Alert**
   - Add alert for NVDA at current price +/- $0.01

2. **Trigger Once**
   - Refresh prices → alert triggers
   - Status changes to "Triggered"
   - Email/webhook sent

3. **Refresh Again**
   - Refresh prices multiple times
   - **Expected**: No additional emails/webhooks
   - **Why**: Alert status is "triggered" (debounced)

### Scenario 6: Fallback Mode (No Credentials)

1. **Unset Environment Variables**
   ```bash
   unset RESEND_API_KEY
   unset ALERT_WEBHOOK_URL
   ```

2. **Create & Trigger Alert**
   - Follow Scenario 3 steps
   - Alert triggers successfully

3. **Check Console**
   - Email fallback: `[Alerts] Email notification (RESEND_API_KEY not configured)`
   - Webhook fallback: `[Alerts] ALERT_WEBHOOK_URL not configured`
   - Full email body logged to console

4. **Verify UI**
   - Alert still triggers in UI
   - Status changes to "Triggered"
   - System works without external services

## API Testing

### List Alerts
```bash
curl http://localhost:3000/api/alerts
```

Expected:
```json
{
  "alerts": [
    {
      "id": "abc123...",
      "symbol": "NVDA",
      "targetPrice": 150.00,
      "condition": "above",
      "status": "active",
      "createdAt": "2026-10-01T06:00:00.000Z",
      "triggeredAt": null,
      "lastPrice": null,
      "notifiedAt": null
    }
  ]
}
```

### Create Alert
```bash
curl -X POST http://localhost:3000/api/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "NVDA",
    "targetPrice": 150.00,
    "condition": "above"
  }'
```

Expected:
```json
{
  "alert": {
    "id": "abc123...",
    "symbol": "NVDA",
    "targetPrice": 150.00,
    "condition": "above",
    "status": "active",
    "createdAt": "2026-10-01T06:00:00.000Z",
    "triggeredAt": null,
    "lastPrice": null,
    "notifiedAt": null
  }
}
```

### Delete Alert
```bash
curl -X DELETE http://localhost:3000/api/alerts/abc123...
```

Expected:
```json
{
  "ok": true
}
```

### Manual Evaluation
```bash
curl -X POST http://localhost:3000/api/alerts/evaluate
```

Expected:
```json
{
  "evaluated": 5,
  "triggered": ["abc123..."]
}
```

## Database Testing

### Check Alerts Table
```sql
SELECT * FROM price_alerts;
```

### Check Active Alerts
```sql
SELECT symbol, target_price, condition, status 
FROM price_alerts 
WHERE status = 'active';
```

### Check Triggered Alerts
```sql
SELECT symbol, target_price, last_price, triggered_at 
FROM price_alerts 
WHERE status = 'triggered';
```

## Debugging

### Console Logs
Search for these log prefixes:
- `[Alerts]` - Alert operations
- `[QuoteService]` - Quote refresh + alert evaluation

### Common Issues

#### Alerts not triggering
- Check: Quote service running? (`[QuoteService]` logs)
- Check: Alert evaluation running? (Look for `Triggered X alerts`)
- Check: Current price vs target price (use `/api/marks` endpoint)

#### Email not sending
- Check: `RESEND_API_KEY` set?
- Check: `ALERT_EMAIL_TO` set?
- Check: Resend API key valid?
- Check: Console shows `Email sent via Resend` or fallback message

#### Webhook not firing
- Check: `ALERT_WEBHOOK_URL` set?
- Check: URL reachable? (Test with curl)
- Check: Console shows `Webhook notification sent`

#### UI not updating
- Check: Browser console for errors
- Check: Hard refresh (Ctrl+Shift+R)
- Check: AlertManager fetching alerts? (Network tab)

## Performance Testing

### Load Test (Multiple Alerts)
1. Create 50 alerts via API
2. Trigger quote refresh
3. Measure: Evaluation time (<1s for 50 alerts)
4. Check: No email/webhook spam (only triggered alerts fire)

### Concurrent Users
1. Multiple browsers create alerts
2. All users see their own + shared alerts
3. No race conditions on trigger

## Cloudflare Pages Testing

### Deploy & Configure
1. Push to main branch
2. Cloudflare auto-deploys
3. Add secrets:
   - `ALERT_EMAIL_TO`
   - `RESEND_API_KEY`
   - `ALERT_WEBHOOK_URL`
4. Wait for deployment

### Test on Production
1. Visit seek-track.pages.dev
2. Create alert via UI
3. Wait for auto-refresh (30s)
4. Check Cloudflare Workers logs for `[Alerts]`

### Monitor
- Cloudflare dashboard → Workers → Logs
- Filter: `[Alerts]`
- Check: Trigger events, email/webhook status

## Edge Cases

### Invalid Input
- Symbol: Empty, special chars, too long
- Target price: Zero, negative, NaN
- Condition: Invalid string

### Race Conditions
- Two quote refreshes trigger simultaneously
- Alert created during evaluation
- Delete during trigger

### Network Failures
- Resend API down
- Webhook endpoint down
- Database unavailable

### Time Zones
- Alert timestamp shows IST (Asia/Kolkata)
- Verify: Email/webhook timestamps match

## Success Criteria

✅ Alert Manager tile appears on Overview  
✅ Create alert: form validation works  
✅ Create alert: symbol autocomplete works  
✅ Create alert: persists to database  
✅ Create alert from Calculator: prefills symbol + target  
✅ Alert evaluation: runs on quote refresh  
✅ Alert trigger: status changes to "triggered"  
✅ Email notification: sends via Resend  
✅ Email notification: falls back to console  
✅ Webhook notification: POSTs JSON  
✅ Webhook notification: falls back to console  
✅ No spam: triggered alert doesn't re-fire  
✅ Delete alert: removes from UI  
✅ Delete alert: soft deletes in DB  
✅ TypeScript builds clean  
✅ No breaking changes to existing features  

## Next Steps

After testing:
1. Mark PR as ready for review (remove draft)
2. Tag Karthik for approval
3. Merge to main
4. Deploy to production
5. Monitor Cloudflare logs for first 24h
6. Gather user feedback
7. Iterate on enhancements (recurring alerts, alert history, etc.)

---

**Questions?** Check PRICE_ALERTS_PR.md or ping in PR comments.
