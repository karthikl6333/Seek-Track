# Plan vs Price Card - Implementation Summary

## Overview

This PR adds a "Plan vs Price" card to the Overview tab, providing a single view for tracking exit targets, stops, no-add-below levels, and deadlines against current prices and holdings.

## Features Implemented

### 1. Data Model

**New D1 table: `plan_rules`**
- Fields: `id`, `symbol`, `account`, `rule_type`, `price_level`, `deadline_date`, `note`, `active`, `created_at`, `updated_at`
- Rule types: `target`, `stop`, `no-add-below`, `deadline`, `note`
- Account scope: `real`, `paper-s0`, `paper-a1`, `paper-c0` (defaults to `real`)
- Indexes for efficient querying by symbol, active status, and account

**New D1 table: `plan_rule_notifications`**
- Tracks which notifications have been sent to prevent duplicates
- Composite key: (`rule_id`, `event_type`)
- Event types: `near`, `hit`, `deadline-tomorrow`, `deadline-today`

### 2. API Endpoints (Behind Existing Auth)

- `GET /api/plan-rules?account=real` - List active rules for account
- `POST /api/plan-rules` - Create new rule (validates required fields)
- `PATCH /api/plan-rules/:id` - Update rule (price level, deadline, note, active flag)
- `DELETE /api/plan-rules/:id` - Soft delete rule (sets `active = 0`)

### 3. UI Component: PlanVsPrice

**Location:** Top of Overview main column (before Holdings table)

**Layout:**
- Compact table showing one row per rule
- Columns: Symbol, Rule Type, Level/Date, Last Price, Avg Cost, Distance, Note, Actions
- Symbols grouped together (avg cost shown once)
- Mobile-friendly: horizontal scroll, compact font sizes

**Visual Indicators:**
- Rule type badges (color-coded: target=green, stop=red, deadline=blue, etc.)
- Status indicators: 🟡 Near (within 3%), 🔴 Hit
- Background highlighting for near/hit rows (amber/red tints)

**Features:**
- Add rule form (inline, toggleable)
- Inline edit (click Edit → input fields replace text)
- Delete with confirmation
- Symbol autocomplete from holdings
- Calculates distance in % and $ from current price
- Shows days remaining for deadline rules (e.g., "2d", "tomorrow", "today")

### 4. Distance Calculation Logic

**Target rules (sell at or above):**
- Hit: `lastPrice >= priceLevel`
- Near: `lastPrice` is within 3% below target (e.g., 146-150 for target 150)
- Normal: beyond 3% below

**Stop/no-add-below rules (threshold from above):**
- Hit: `lastPrice <= priceLevel`
- Near: `lastPrice` is within 3% above level
- Normal: beyond 3% above

**Configurable threshold:** 3% hardcoded now, can be made configurable later

### 5. Away-from-Desk Alerts

**Email notifications via Resend (same infrastructure as price alerts):**

**Events:**
1. **Near**: Price enters the 3% band (one email per rule/symbol)
2. **Hit**: Price crosses the level (one email per rule/symbol)
3. **Deadline Tomorrow**: Sent the day before deadline
4. **Deadline Today**: Sent on deadline day

**Deduplication:**
- `plan_rule_notifications` table tracks sent events by `(rule_id, event_type)`
- Each event emails once; won't spam if price oscillates in the band

**Trigger mechanism:**
- Near/hit events: evaluated after every quote refresh (integrated into `quote-service.ts`)
- Deadline events: daily cron check at midnight (Node.js only; Cloudflare uses scheduled triggers)

**Environment variables (already exist for price alerts):**
- `ALERT_EMAIL_TO` - recipient email
- `RESEND_API_KEY` - Resend API key
- `ALERT_EMAIL_FROM` - sender email (optional, defaults to `alerts@seek-track.com`)

### 6. Seeded Rules (Editable Data)

**File:** `server/seed-plan-rules.ts`

**Seeds:**
1. SOXL target 150 (note: "don't rebuy before Nov 4")
2. AVL target 35.44
3. AVL deadline 2026-10-16 (note: "sell at close if still under avg 38.04")
4. SMH stop 561.92
5. SMH no-add-below 585.33 (note: "max 20% of equity")

**Usage:** Run once via seed function or manually via UI

### 7. Tests

**File:** `server/plan-rules.test.ts`

**Coverage:**
- Distance calculation for target/stop/no-add-below rules
- Edge cases (null values, boundary conditions)
- Real-world scenarios with seed data
- Alert deduplication logic

**Results:** 24 tests passing ✅

### 8. Hard Constraints Met

✅ No news or trade recommendation logic (only user's own rules)
✅ Fits existing patterns (similar to AlertManager component)
✅ Phone-friendly (compact table, horizontal scroll)
✅ Minimal styling (matches existing card design)
✅ No restructuring of other tabs or Overview layout

## File Changes

### New Files
- `server/plan-rules.ts` - CRUD operations for plan rules
- `server/plan-rule-notifications.ts` - Email notification logic
- `server/seed-plan-rules.ts` - Seed initial rules
- `server/plan-rules.test.ts` - Unit tests (24 tests)
- `src/components/PlanVsPrice.tsx` - UI component

### Modified Files
- `server/schema-d1.sql` - Added `plan_rules` and `plan_rule_notifications` tables
- `server/index.ts` - Added routes and daily cron for deadline checks
- `server/quote-service.ts` - Integrated notification evaluation
- `src/components/Overview.tsx` - Added PlanVsPrice component
- `src/lib/db.ts` - Added client-side API functions
- `src/types/index.ts` - Added PlanRule types

## Deployment Notes

### Database Migration
The schema is automatically applied via `ensureSchema()` on boot (existing pattern).

### Cron Configuration
**Node.js (local/Render):** Daily deadline check runs automatically at midnight.

**Cloudflare Pages:** No built-in cron. Options:
1. Use Cloudflare Cron Triggers (requires wrangler.toml config):
   ```toml
   [triggers]
   crons = ["0 0 * * *"]  # Daily at midnight UTC
   ```
   Then add a `functions/scheduled.ts` handler that calls `evaluatePlanRuleNotifications()`

2. Use external cron (e.g., GitHub Actions, UptimeRobot) to POST to a webhook endpoint

3. Rely on price refresh (every 30s) to catch near/hit events; deadline alerts may be delayed up to 24h

**Recommended:** Add Cloudflare Cron Trigger for production.

### Environment Variables
Already configured for price alerts; no new vars needed.

### Seeding Data
Run seed function once:
```typescript
import { seedPlanRules } from './server/seed-plan-rules.js';
await seedPlanRules();
```

Or add via UI (more flexible).

## Testing Locally

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Navigate to Overview tab**

3. **Verify Plan vs Price card appears** at the top

4. **Add a rule:**
   - Click "+ Add rule"
   - Enter symbol (e.g., SOXL), rule type (target), price level (150), note
   - Click "Add Rule"

5. **Test distance calculation:**
   - Refresh prices (click "↻ Refresh prices")
   - Verify distance % and $ are calculated correctly
   - Verify status indicators (🟡 near, 🔴 hit) appear at appropriate thresholds

6. **Test edit/delete:**
   - Click "Edit" on a rule
   - Update price level or note
   - Click "Save"
   - Verify changes persist

7. **Test notifications (if Resend configured):**
   - Add a rule with a price level very close to current price
   - Wait for next refresh (30s)
   - Check email for "near" alert
   - Update rule to be below current price
   - Wait for refresh
   - Check email for "hit" alert

## Screenshots

### Desktop View
(Card appears at top of Overview, above Holdings table)

### Mobile View
(Table scrolls horizontally, compact layout preserved)

## Known Limitations / Future Enhancements

1. **3% threshold is hardcoded** - could be made configurable per user/rule
2. **Cloudflare cron requires manual setup** - no automatic daily deadline check without cron trigger
3. **No recurring alerts** - each event fires once (can manually recreate rule)
4. **No alert history** - only tracks "has been notified" state
5. **No bulk import** - rules added one at a time via UI or API
6. **Real account only in UI** - paper accounts supported in API but not exposed in UI yet

## Breaking Changes

None. This is purely additive.

## Deployment Checklist

- [x] Schema migration automatic (ensureSchema on boot)
- [x] TypeScript build passes
- [x] Tests pass (24/24)
- [x] No breaking changes
- [ ] Seed initial rules (optional, can be done via UI)
- [ ] Configure Cloudflare Cron Trigger for deadline alerts (production only)
- [ ] Verify email notifications work (test with RESEND_API_KEY)

---

**Resolves:** User request for Plan vs Price card with exit targets, stops, deadlines, and email alerts
