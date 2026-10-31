# Plan vs Price - Deployment Notes

## What This Adds

A "Plan vs Price" card on the Overview tab for tracking exit targets, stops, no-add-below levels, and deadlines against current prices, with email alerts.

## Deploy Requirements

### 1. Database Migration
✅ **Automatic** - Tables created on first boot via `ensureSchema()`

### 2. Seeding Initial Rules
✅ **Automatic** - Five rules seeded on first boot (idempotent, won't duplicate)

Seeds:
- SOXL target 150
- AVL target 35.44
- AVL deadline 2026-10-16
- SMH stop 561.92
- SMH no-add-below 585.33

### 3. Email Notifications
✅ **No new config** - Uses existing `ALERT_EMAIL_TO`, `RESEND_API_KEY`

Events (deduplicated):
- Near: Price enters 3% band
- Hit: Price crosses level
- Deadline-tomorrow: Day before deadline
- Deadline-today: On deadline day

### 4. Trigger Mechanism
✅ **Works on Cloudflare Pages** - All events checked during quote refresh (every 30s)

Deadline notifications deduplicated per calendar day (won't spam).

## Post-Deploy Verification

1. Navigate to Overview tab
2. Verify "Plan vs Price" card appears at top
3. Check that 5 rules are visible
4. Add a test rule via "+ Add rule"
5. Edit/delete to verify CRUD works
6. (Optional) Test email with RESEND_API_KEY

## Breaking Changes

None. Purely additive.

## Rollback

Revert commit and redeploy. Tables can be dropped if needed:
```sql
DROP TABLE IF EXISTS plan_rule_notifications;
DROP TABLE IF EXISTS plan_rules;
```
