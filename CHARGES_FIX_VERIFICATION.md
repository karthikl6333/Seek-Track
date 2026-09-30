# Charges Fix Verification - Live Data

## User Confirmation
✅ Holdings updated (MUZ visible)  
❌ **Charges did NOT update** after latest CSV import

## Rows in Database (09/29-09/30/2026)
```
1. Buy MUZ qty 3000 amount -20100
2. Cash Dividend AVL amount 2377.08
3. NRA Tax Adj AVL amount -713.12
```

## Root Cause
**File:** `src/lib/charges.ts`  
**Pattern:** `FEE_LIKE = /\b(fee|commission|charge)\b/i`

Missing "tax" keyword → **"NRA Tax Adj" not counted**

## The Fix

### Changed Pattern
```typescript
// Before
const FEE_LIKE = /\b(fee|commission|charge)\b/i;

// After
const FEE_LIKE = /\b(fee|commission|charge|tax)\b/i;
const DIVIDEND = /dividend/i;
```

### Logic Update
```typescript
// Exclude dividends from fee calculation
if (FEE_LIKE.test(hay) && qty === 0 && price === 0 && feeAbs === 0 && !DIVIDEND.test(hay)) {
  fees += Math.abs(Number(t.amount) || 0);
}
```

## Pattern Matching Results

| Action | FEE_LIKE Match | DIVIDEND Match | Counted in Charges? |
|--------|---------------|----------------|---------------------|
| **Buy MUZ** | ❌ No | ❌ No | ❌ No (has qty/price) |
| **Cash Dividend AVL** | ❌ No | ✅ Yes | ❌ No (income) |
| **NRA Tax Adj AVL** | ✅ Yes (tax) | ❌ No | ✅ **Yes** |

## Expected Behavior After Fix

### Charges Summary (Overview tile)
```
fees: 713.12 (from NRA Tax Adj)
marginInterest: 0 (none in these rows)
totalCharges: 713.12
```

### Charges Tab Rows
```
Date       | Action        | Symbol | Amount    | Type
-----------|---------------|--------|-----------|-------------
09/29/2026 | NRA Tax Adj   | AVL    | -713.12   | other_charge
```

**Cash Dividend** and **Buy MUZ** should NOT appear in charges list.

## Why Holdings Updated But Charges Didn't

### Holdings Pipeline
1. CSV Import → DB ✅
2. `importCsvText()` → `refresh()` → `setTrades()` ✅
3. `analysis` memo recalculates → `computePositions(trades)` ✅
4. MUZ position computed correctly ✅

### Charges Pipeline (Before Fix)
1. CSV Import → DB ✅
2. `importCsvText()` → `refresh()` → `setTrades()` ✅
3. `charges = summarizeCharges(store.trades)` executes ✅
4. **BUT:** Pattern doesn't match "NRA Tax Adj" ❌
5. Result: Charges stay at old value ❌

### Charges Pipeline (After Fix)
1. CSV Import → DB ✅
2. `importCsvText()` → `refresh()` → `setTrades()` ✅
3. `charges = summarizeCharges(store.trades)` executes ✅
4. Pattern matches "NRA Tax Adj" ✅
5. Result: Charges += 713.12 ✅

## Test Coverage

### Live Data Test
```typescript
it('should handle exact live data from user report', () => {
  const trades = [
    { action: 'Buy', symbol: 'MUZ', qty: 3000, ... },
    { action: 'NRA Tax Adj', symbol: 'AVL', amount: -713.12, ... },
    { action: 'Cash Dividend', symbol: 'AVL', amount: 2377.08, ... },
  ];
  
  const summary = summarizeCharges(trades);
  expect(summary.fees).toBe(713.12);        // ✅ Only tax
  expect(summary.totalCharges).toBe(713.12); // ✅ Correct total
  
  const rows = listChargeRows(trades);
  expect(rows).toHaveLength(1);              // ✅ Only NRA Tax row
  expect(rows[0].action).toBe('NRA Tax Adj'); // ✅ Correct action
});
```

**Result:** ✅ All 5 tests passing

## No Other Issues Found

### ✅ No Date Filtering
- Charges component: No date range filters
- All trades from `store.trades` processed

### ✅ No Caching Issues
- `useMemo(() => summarizeCharges(store.trades), [store.trades])`
- Recomputes whenever `store.trades` changes
- `refresh()` calls `setTrades()` → triggers memo update

### ✅ Action Type Handling Complete
```typescript
✅ Fees column (feeAbs > 0) → counted
✅ Margin Interest → counted separately  
✅ Credit Interest → counted separately
✅ Tax/Fee/Commission/Charge actions (qty=0, price=0) → counted
✅ Dividend actions → excluded
✅ Regular trades (qty>0 or price>0) → not included
```

## Deployment

### PR #66
- Branch: `cursor/fix-ui-refresh-after-import-6bbd`
- Status: Ready for review
- Changes: 2 files (charges.ts + test)
- Tests: 5 new tests, all passing

### After Merge
User should see:
1. Hard refresh browser (Ctrl+Shift+R)
2. Charges tile shows +713.12 (from NRA Tax Adj)
3. Charges tab shows NRA Tax Adj row
4. Cash Dividend NOT in charges (correctly excluded)

## Summary

**Problem:** NRA Tax Adj not counted → Charges stale  
**Fix:** Add 'tax' to FEE_LIKE pattern → Charges update  
**Risk:** Minimal (1 pattern change, 1 exclusion)  
**Testing:** Live data verified, 5 tests passing
