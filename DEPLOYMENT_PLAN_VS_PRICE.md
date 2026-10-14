# Plan vs Price - Deployment Guide

## Pre-Deployment Checklist

- [x] Schema migration automatic (ensureSchema on boot)
- [x] TypeScript build passes
- [x] Tests pass (24/24)
- [x] Cloudflare scheduled function added
- [x] No breaking changes

## Deployment Steps

### 1. Database Migration

**Automatic** - Schema updates applied on first boot via `ensureSchema()`

Tables created:
- `plan_rules` - User-defined price targets, stops, deadlines
- `plan_rule_notifications` - Deduplication log for email alerts

No manual SQL needed.

### 2. Seed Initial Rules (Optional)

After deployment, seed the 5 initial rules via one of these methods:

#### Option A: Via API (recommended)
```bash
curl -X POST https://seek-track.pages.dev/api/plan-rules \
  -H "Content-Type: application/json" \
  -u "admin:YOUR_AUTH_PASSWORD" \
  -d '{"symbol":"SOXL","ruleType":"target","priceLevel":150,"note":"don'\''t rebuy before Nov 4"}'

curl -X POST https://seek-track.pages.dev/api/plan-rules \
  -H "Content-Type: application/json" \
  -u "admin:YOUR_AUTH_PASSWORD" \
  -d '{"symbol":"AVL","ruleType":"target","priceLevel":35.44}'

curl -X POST https://seek-track.pages.dev/api/plan-rules \
  -H "Content-Type: application/json" \
  -u "admin:YOUR_AUTH_PASSWORD" \
  -d '{"symbol":"AVL","ruleType":"deadline","deadlineDate":"2026-10-16","note":"sell at close if still under avg 38.04"}'

curl -X POST https://seek-track.pages.dev/api/plan-rules \
  -H "Content-Type: application/json" \
  -u "admin:YOUR_AUTH_PASSWORD" \
  -d '{"symbol":"SMH","ruleType":"stop","priceLevel":561.92}'

curl -X POST https://seek-track.pages.dev/api/plan-rules \
  -H "Content-Type: application/json" \
  -u "admin:YOUR_AUTH_PASSWORD" \
  -d '{"symbol":"SMH","ruleType":"no-add-below","priceLevel":585.33,"note":"max 20% of equity"}'
```

#### Option B: Via UI
1. Navigate to Overview tab
2. Find "Plan vs Price" card at top
3. Click "+ Add rule"
4. Enter each rule manually

#### Option C: Via Node.js (local/Render only)
```bash
# SSH into server or run locally
node -e "import('./dist-server/seed-plan-rules.js').then(m => m.seedPlanRules())"
```

### 3. Configure Cloudflare Cron (Production)

**Status:** ✅ Already configured in `wrangler.toml` + `functions/scheduled.ts`

Cron runs daily at midnight UTC to check deadline proximity and send alerts.

**Verify after deployment:**
```bash
# Check Cloudflare Dashboard > Workers & Pages > seek-track > Triggers
# Should show: Cron Trigger - "0 0 * * *" (Daily at 00:00 UTC)
```

**Test cron manually:**
```bash
# Trigger via Cloudflare dashboard (Workers > Triggers > Test)
# Or wait until midnight UTC and check logs
```

### 4. Verify Email Configuration

Uses existing environment variables (no new setup needed):

**Required:**
- `ALERT_EMAIL_TO` - Recipient email (e.g., `karthik@example.com`)
- `RESEND_API_KEY` - Resend API key (free tier: 100 emails/day)

**Optional:**
- `ALERT_EMAIL_FROM` - Sender email (defaults to `alerts@seek-track.com`)

**Test notifications:**
1. Add a rule with price level very close to current price
2. Wait for next quote refresh (30 seconds)
3. Check email for "near" alert
4. Verify email contains: symbol, rule type, distance, note

### 5. Deploy to Cloudflare Pages

```bash
# Build for Cloudflare
npm run build:cf

# Deploy
wrangler pages deploy dist-cf --project-name=seek-track

# Or via CI/CD (GitHub Actions)
git push origin main
```

### 6. Post-Deployment Verification

#### UI Tests
1. Navigate to https://seek-track.pages.dev
2. Go to Overview tab
3. Verify "Plan vs Price" card appears at top
4. Click "+ Add rule" and add a test rule
5. Verify rule appears in table with correct formatting
6. Click "Edit" and modify a field
7. Verify changes persist after save
8. Click "Delete" and confirm deletion
9. Verify row disappears

#### Mobile Tests
1. Open on mobile device or narrow browser
2. Verify table scrolls horizontally
3. Verify compact layout is readable
4. Verify add/edit forms are usable

#### API Tests
```bash
# List rules
curl -u "admin:PASSWORD" https://seek-track.pages.dev/api/plan-rules

# Create rule
curl -X POST -H "Content-Type: application/json" \
  -u "admin:PASSWORD" \
  https://seek-track.pages.dev/api/plan-rules \
  -d '{"symbol":"TEST","ruleType":"target","priceLevel":100}'

# Update rule
curl -X PATCH -H "Content-Type: application/json" \
  -u "admin:PASSWORD" \
  https://seek-track.pages.dev/api/plan-rules/RULE_ID \
  -d '{"priceLevel":105}'

# Delete rule
curl -X DELETE -u "admin:PASSWORD" \
  https://seek-track.pages.dev/api/plan-rules/RULE_ID
```

#### Email Tests
1. Add rule with price level near current price (within 3%)
2. Wait 30 seconds for quote refresh
3. Check inbox for "near" email
4. Update rule to be crossed
5. Wait 30 seconds
6. Check inbox for "hit" email
7. Add deadline rule for tomorrow
8. Wait until midnight UTC
9. Check inbox for "deadline tomorrow" email

#### Cron Tests
1. Check Cloudflare dashboard logs at midnight UTC
2. Verify `[Scheduled] Running daily plan rule notifications check`
3. Verify no errors in logs
4. If deadline alerts exist, verify emails sent

## Rollback Plan

If issues arise:

1. **UI issues:** Card can be hidden by removing `<PlanVsPrice />` from Overview
2. **API issues:** Routes can be disabled by commenting out in `server/index.ts`
3. **Schema issues:** Tables can be dropped (data loss):
   ```sql
   DROP TABLE IF EXISTS plan_rule_notifications;
   DROP TABLE IF EXISTS plan_rules;
   ```
4. **Full rollback:** Revert to previous commit and redeploy

## Environment-Specific Notes

### Cloudflare Pages (Production)
- ✅ Cron configured for daily deadline checks
- ✅ Near/hit alerts fire on every quote refresh (30s)
- ✅ Email via Resend (uses existing config)
- ✅ Schema migration automatic

### Node.js (Local/Render)
- ✅ Cron runs automatically at midnight
- ✅ Near/hit alerts fire on every quote refresh (30s)
- ✅ Email via Resend (uses existing config)
- ✅ Schema migration automatic

### Development (Local)
- ⚠️ No cron by default (can be enabled)
- ✅ Near/hit alerts fire on quote refresh
- ⚠️ Email uses console fallback if no Resend key
- ✅ Schema migration automatic

## Monitoring

### Logs to Watch
```
[PlanRules] GET /api/plan-rules
[PlanRules] POST /api/plan-rules
[QuoteService] Sent N plan rule notifications
[Scheduled] Running daily plan rule notifications check
[PlanRuleNotifications] Email sent: { id: ..., to: ... }
```

### Errors to Watch
```
[PlanRules] POST /api/plan-rules failed: Invalid symbol
[PlanRuleNotifications] Failed to send email: ...
[Scheduled] Failed to evaluate plan rule notifications: ...
```

### Metrics to Track
- Number of active rules per user
- Email notifications sent per day
- Near/hit alert accuracy (false positives?)
- Deadline alert timing (on time vs delayed)

## Troubleshooting

### "Card doesn't appear"
- Check browser console for React errors
- Verify Overview component imported PlanVsPrice
- Verify TypeScript build succeeded

### "Add rule fails"
- Check required fields (symbol, ruleType)
- Verify price level is positive for price rules
- Verify deadline date is set for deadline rules
- Check browser network tab for API error

### "Email not received"
- Verify `ALERT_EMAIL_TO` is set
- Verify `RESEND_API_KEY` is valid
- Check Resend dashboard for delivery status
- Check spam folder
- Verify notification wasn't already sent (dedupe log)

### "Cron not running"
- Verify wrangler.toml has `[triggers]` section
- Check Cloudflare dashboard > Workers > Triggers
- Manually trigger cron in dashboard
- Check logs for errors

### "Distance calculation wrong"
- Verify marks table has current prices
- Check quote refresh is running (30s interval)
- Verify rule type matches expectation (target vs stop)
- Check 3% threshold logic in PlanVsPrice component

## Support

For issues or questions:
1. Check logs in Cloudflare dashboard
2. Review PR #87 discussion
3. Check existing issues on GitHub
4. File new issue with reproduction steps

---

**Deployment completed:** [Date]  
**Deployed by:** [Name]  
**Environment:** Production / Staging / Local  
**Seeded rules:** Yes / No  
**Cron verified:** Yes / No  
**Email tested:** Yes / No
