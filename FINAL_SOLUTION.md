# Final Solution: Charges Fix with AVGO Exclusion

## User Requirements (Final)

1. ✅ Include Cash Dividend / Qualified Dividend (and NRA Tax Adj)
2. ✅ Net after-tax dividend as **credit that reduces total charges**
3. ✅ **Exclude AVGO** dividends and taxes from charges
4. ✅ All other symbols (e.g. AVL) net into charges

## Problem Statement

**Charges page shows only through Sept 28**, missing:
- Cash Dividend AVL +2377.08 (in database)
- NRA Tax Adj AVL -713.12 (in database)

**Root cause:** Old client code doesn't recognize these action patterns.

## Solution (PR #65)

### Code Changes

**File:** `src/lib/charges.ts`

```typescript
// Patterns
const FEE_LIKE = /\b(fee|commission|charge|tax)\b/i;  // Added "tax"
const DIVIDEND = /dividend/i;                          // Handle dividends
const EXCLUDED_SYMBOLS = ['AVGO'];                     // Exclude AVGO

// Formula
totalCharges = fees + marginInterest - dividendIncome

// Exclusion logic
const symbol = (t.symbol ?? '').toUpperCase();
const isExcluded = EXCLUDED_SYMBOLS.includes(symbol);
if (isExcluded) continue;  // Skip AVGO entirely
```

### Behavior Matrix

| Symbol | Action Type | Amount | Effect on Charges | Shown in UI |
|--------|-------------|--------|-------------------|-------------|
| **AVL** | Cash Dividend | +2377.08 | dividendIncome += 2377.08 | ✅ YES (reduces charges) |
| **AVL** | NRA Tax Adj | -713.12 | fees += 713.12 | ✅ YES (increases charges) |
| **AVL** | **Net** | **+1663.96** | **totalCharges -= 1663.96** | **✅ Credit** |
| **AVGO** | Qualified Dividend | +500.00 | *Skipped* | ❌ NO (excluded) |
| **AVGO** | NRA Tax Adj | -75.00 | *Skipped* | ❌ NO (excluded) |

### Expected Results

#### Charges Summary (with live data)
```
Total charges: -1663.96
  └─ Calculation: 713.12 (fees) + 0 (margin) - 2377.08 (dividends)
  
Fees: 713.12
  └─ Includes: AVL NRA Tax Adj
  └─ Excludes: AVGO taxes
  
Dividend income: 2377.08
  └─ Includes: AVL Cash Dividend
  └─ Excludes: AVGO dividends
  
Margin interest: 0
```

#### Charges Tab Rows
```
Date       | Action           | Symbol | Amount    | Type
-----------|------------------|--------|-----------|----------------
09/30/2026 | Buy              | MUZ    | —         | (not shown - trade)
09/29/2026 | Cash Dividend    | AVL    | +2377.08  | dividend_income ✅
09/29/2026 | NRA Tax Adj      | AVL    | -713.12   | other_charge ✅
           | (AVGO rows excluded - not shown)                      ❌
09/28/2026 | ...              | ...    | ...       | ...
```

## Test Coverage

### Test 1: AVL Net After-Tax
```typescript
AVL Cash Dividend: +2377.08
AVL NRA Tax Adj:   -713.12
─────────────────────────────
Net credit:        +1663.96 ✅
Total charges:     -1663.96 ✅
```

### Test 2: AVGO Exclusion
```typescript
AVL dividend:    +2377.08  → Included ✅
AVL tax:         -713.12   → Included ✅
AVGO dividend:   +500.00   → Excluded ✅
AVGO tax:        -75.00    → Excluded ✅

Result:
  fees: 713.12 (only AVL)
  dividendIncome: 2377.08 (only AVL)
  totalCharges: -1663.96 (AVGO not counted)
```

### Test 3: Charge Rows
```typescript
Rows shown: 2 (AVL dividend + tax) ✅
AVGO rows:  0 (excluded)           ✅
```

**All tests: 8/8 passing**

## Why Charges Stopped at Sept 28

1. All transactions through Sept 28: Regular trades (Buy/Sell)
2. Sept 29 transactions: Dividends and taxes
3. Old code: Doesn't recognize dividend/tax patterns
4. Result: Sept 29 rows filtered out, last shown = Sept 28

**Not a date bug** - it's a pattern matching bug.

## Deployment Checklist

### Before Deployment
- ✅ Tests passing (8/8)
- ✅ Build successful
- ✅ AVGO exclusion verified
- ✅ Net dividend formula correct

### Deployment Steps
1. Merge PR #65
2. Cloudflare Pages auto-deploy
3. Wait for deploy complete (~2 min)

### User Verification
1. **Hard refresh browser** (Ctrl+Shift+R) ← IMPORTANT
2. Navigate to Charges tab
3. Verify AVL rows visible:
   - Cash Dividend AVL: +2377.08 ✅
   - NRA Tax Adj AVL: -713.12 ✅
4. Verify totals:
   - Total charges: -1663.96 ✅
   - Dividend income: 2377.08 ✅
5. Verify AVGO excluded (if any AVGO rows exist)

## Formula Breakdown

### AVL (Included)
```
Gross charges:
  Fees (NRA Tax):           713.12
  Margin interest:            0.00
  ────────────────────────────────
  Subtotal:                 713.12

Less: Dividend income
  Cash Dividend:         -2377.08
  ────────────────────────────────
  
Net charges (credit):    -1663.96 ✅
```

### AVGO (Excluded)
```
Dividend:                 (skipped)
Tax:                      (skipped)
────────────────────────────────
Impact on charges:            0.00 ✅
```

## Files Changed

```
src/lib/charges.ts           - Core logic (80 lines changed)
src/lib/charges.test.ts      - Test suite (220 lines)
src/components/Charges.tsx   - UI labels (10 lines)
src/components/Overview.tsx  - Tile display (5 lines)
```

**Total: 4 files, ~315 lines**

## Edge Cases Handled

1. ✅ Multiple dividend types (Cash, Qualified)
2. ✅ Tax adjustments without dividends
3. ✅ Dividends without tax adjustments
4. ✅ AVGO symbol (upper/lowercase variants)
5. ✅ Mixed symbols in same import
6. ✅ Zero amounts
7. ✅ Regular trade fees still counted

## Performance Impact

- ✅ No additional API calls
- ✅ Same React re-render behavior
- ✅ Minimal computation overhead (symbol check)
- ✅ No database changes needed

## Future Extensibility

To exclude more symbols:
```typescript
const EXCLUDED_SYMBOLS = ['AVGO', 'SYMBOL2', 'SYMBOL3'];
```

To include them again:
```typescript
const EXCLUDED_SYMBOLS = []; // Empty array
```

## Summary

**Problem:** Charges stops at Sept 28  
**Root cause:** Old code doesn't recognize dividend/tax patterns  
**Solution:** Add patterns + AVGO exclusion  
**Result:** Sept 29 AVL rows appear, AVGO excluded  
**Formula:** Net after-tax dividend reduces total charges  
**Status:** ✅ Ready to deploy (PR #65)
