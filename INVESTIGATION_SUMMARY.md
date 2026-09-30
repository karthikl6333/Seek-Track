# Investigation Summary: Charges Not Updating After CSV Import

## Initial Bug Report
User uploaded new Schwab CSV. Holdings updated correctly, but **Charges did not refresh**.

## Investigation Phase 1: Wrong Hypothesis ❌

**Initial diagnosis:** CSV import filtering out interest/fee rows  
**PR #65 (closed):** Modified CSV parser to import interest rows  
**Problem:** This was based on incorrect assumption that import was failing

## Phase 2: Live Data Analysis ✅

User provided critical live DB facts:
- ✅ Import **DID succeed** (importedAt: 2026-09-30T12:37:35.503Z)
- ✅ New rows in database:
  - Buy MUZ (3000 qty, -20100 amount)
  - **NRA Tax Adj** AVL (-713.12 amount)
  - **Cash Dividend** AVL (+2377.08 amount)
- ✅ Holdings calculation correct (MUZ 3000, AVL 11000, etc.)
- ❌ Charges not reflecting NRA Tax Adj

## Root Cause (Actual)

**File:** `src/lib/charges.ts`  
**Issue:** FEE_LIKE pattern only matched: `/\b(fee|commission|charge)\b/i`

```typescript
// Lines 52-56 (original)
const hay = `${action} ${t.description ?? ''}`;
if (FEE_LIKE.test(hay) && qty === 0 && price === 0 && feeAbs === 0) {
  fees += Math.abs(Number(t.amount) || 0);
}
```

**"NRA Tax Adj"** contains "tax" not "fee/commission/charge" → **not matched**  
**"Cash Dividend"** is income → **should be excluded** anyway

## The Fix (Minimal) ✅

**Changed:** `src/lib/charges.ts`

1. Added `'tax'` to pattern: `/\b(fee|commission|charge|tax)\b/i`
2. Added DIVIDEND exclusion: `/dividend/i`
3. Updated both `summarizeCharges()` and `listChargeRows()`

```typescript
const FEE_LIKE = /\b(fee|commission|charge|tax)\b/i;
const DIVIDEND = /dividend/i;

// In summarizeCharges:
if (FEE_LIKE.test(hay) && qty === 0 && price === 0 && feeAbs === 0 && !DIVIDEND.test(hay)) {
  fees += Math.abs(Number(t.amount) || 0);
}
```

## What Was NOT Broken

1. ✅ **CSV import** - Working correctly, rows in database
2. ✅ **Client refresh** - `importCsvText()` calls `refresh()`, `setTrades()` triggers `analysis` recompute
3. ✅ **Holdings calculation** - FIFO lot engine correct
4. ✅ **Interest rows** - Margin/Credit Interest already handled
5. ✅ **Fee column charges** - Non-zero `fees` field already counted

## Impact of Fix

**Before:**
- Regular fees: ✅ Counted (fees column)
- Margin/Credit Interest: ✅ Counted (action pattern)
- **NRA Tax Adj**: ❌ Not counted (missing 'tax' keyword)
- Cash Dividend: ⚠️ Would be counted if pattern matched (incorrect)

**After:**
- Regular fees: ✅ Counted
- Margin/Credit Interest: ✅ Counted
- **NRA Tax Adj**: ✅ Counted (now matches FEE_LIKE)
- Cash Dividend: ✅ Excluded (DIVIDEND pattern)

## Test Coverage

**New:** `src/lib/charges.test.ts`
- ✅ NRA Tax Adj counted as charge
- ✅ Cash Dividend excluded from charges
- ✅ Mixed CSV with fees, tax, dividends, interest
- ✅ listChargeRows filters correctly

**Total:** 14 tests passing (4 new + 3 lots + 7 csv)

## Pull Requests

- **PR #65** - Incorrect diagnosis (CSV import "fix"), should be closed
- **PR #66** - Correct minimal fix (charges calculation)

## Key Lessons

1. **Verify assumptions with live data** before making changes
2. **Distinguish import success from calculation bugs** - different layers
3. **Tax adjustments are charges** - pattern must include 'tax' keyword
4. **Dividends are income** - explicitly exclude from charges
5. **Minimal changes** - only fix what's actually broken

## Files Changed (Final)

```
src/lib/charges.ts - Added 'tax' keyword, DIVIDEND exclusion (4 lines)
src/lib/charges.test.ts - New comprehensive test suite (158 lines)
```

## Verification Steps for User

1. Hard refresh browser (Ctrl+Shift+R) to get new client bundle
2. Navigate to Charges tab
3. Verify:
   - NRA Tax Adj rows appear in charge list
   - Total charges includes tax adjustments
   - Cash Dividend does NOT appear in charges
   - Overview Charges tile shows correct total

## Expected Charges Total

Using live data:
- Existing fees: ~50.45 (Sell commissions, etc.)
- NRA Tax Adj: 713.12 (AVL, Sept 29)
- Margin Interest: (if any in prior imports)
- **Total: ~763.57+** (depends on all interest rows)

Cash Dividend (+2377.08) correctly NOT included.
