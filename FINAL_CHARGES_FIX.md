# Final Charges Fix: Net After-Tax Dividend

## User Requirements (Clarified)

For AVL Cash Dividend + NRA Tax Adj pairs:
- **Net the after-tax dividend into Charges as a credit that reduces total**
- Example: Cash Dividend +2377.08 + NRA Tax Adj -713.12 → net +1663.96 reduces Charges
- Not: ignore dividend ❌
- Not: treat both as unrelated ❌

## Live Data (09/29-09/30/2026)

```
Buy MUZ qty 3000 amount -20100        → Not in charges (trade)
Cash Dividend AVL amount +2377.08     → Dividend income (credit)
NRA Tax Adj AVL amount -713.12        → Fee/tax (charge)
```

## Solution

### Formula Change

**Before (incorrect):**
```typescript
totalCharges = fees + marginInterest
// Dividends excluded entirely
```

**After (correct):**
```typescript
totalCharges = fees + marginInterest - dividendIncome
// Net after-tax dividend reduces charges
```

### Pattern Matching

| Action | Pattern | Effect |
|--------|---------|--------|
| **NRA Tax Adj** | `FEE_LIKE` (contains "tax") | → fees += 713.12 |
| **Cash Dividend** | `DIVIDEND` | → dividendIncome += 2377.08 |
| **Net Result** | | → totalCharges = 713.12 - 2377.08 = **-1663.96** |

### ChargesSummary Interface

```typescript
interface ChargesSummary {
  fees: number;              // 713.12
  marginInterest: number;    // 0
  creditInterest: number;    // 0
  dividendIncome: number;    // 2377.08 (NEW)
  totalCharges: number;      // -1663.96 (net credit)
}
```

## UI Changes

### Overview Charges Tile

**Before:**
```
Charges: [totalCharges]
Fees [fees] · Margin [marginInterest]
```

**After:**
```
Charges: -1663.96
Fees 713.12 · Margin 0 · Div 2377.08
```

### Charges Tab (4 cards)

1. **Total charges:** -1663.96  
   *Fees + margin interest − dividends*
   
2. **Fees:** 713.12  
   *Fees, commissions, taxes*
   
3. **Margin interest:** 0  
   *Debit interest*
   
4. **Dividend income:** 2377.08 ← NEW  
   *After-tax dividend credit*

### Charges Tab Rows

| Date | Action | Symbol | Amount | Type |
|------|--------|--------|--------|------|
| 09/29 | NRA Tax Adj | AVL | -713.12 | other_charge |
| 09/29 | Cash Dividend | AVL | +2377.08 | dividend_income |

**Both rows appear** in the table (not netted in display, but netted in total).

## Behavior Verification

### Test: Exact Live Data

```typescript
trades = [
  { action: 'Buy', symbol: 'MUZ', qty: 3000 },
  { action: 'NRA Tax Adj', symbol: 'AVL', amount: -713.12 },
  { action: 'Cash Dividend', symbol: 'AVL', amount: +2377.08 },
];

summarizeCharges(trades) →
  fees: 713.12
  dividendIncome: 2377.08
  totalCharges: -1663.96 ✅

listChargeRows(trades) →
  2 rows: [NRA Tax Adj, Cash Dividend] ✅
```

### Import → Refresh Flow

1. CSV uploaded with NRA Tax Adj + Cash Dividend
2. `importCsvText()` → `db.importCsvText()` → rows inserted ✅
3. `refresh()` → `setTrades(newTrades)` ✅
4. `analysis` memo → recomputes positions ✅
5. **`charges = summarizeCharges(store.trades)`** → recomputes ✅
6. Charges tile shows: **-1663.96** ✅
7. Charges tab shows: Both rows, net total ✅

## Test Results

```bash
✓ src/lib/charges.test.ts (5 tests)
  ✓ should count NRA Tax Adj as fee charge
  ✓ should count dividend income and reduce total charges
  ✓ should net dividend income with tax to reduce total charges
  ✓ should include both NRA Tax Adj and dividends as separate rows
  ✓ should handle exact live data with net after-tax dividend

✓ src/lib/lots.test.ts (3 tests)

Total: 8 tests passing
```

## Files Changed (Minimal)

```
src/lib/charges.ts           - Core logic (add dividendIncome, net formula)
src/lib/charges.test.ts      - Tests updated for new behavior
src/components/Charges.tsx   - 4th card for dividend income
src/components/Overview.tsx  - Show dividend in tile
```

## Expected User Experience

### After PR Deploys

1. User opens app (hard refresh)
2. **Overview Charges tile:**
   - Shows: **-1663.96** (net credit)
   - Breakdown: "Fees 713.12 · Margin 0 · Div 2377.08"

3. **Click → Charges tab:**
   - Total charges card: **-1663.96**
   - Dividend income card: **2377.08**
   - Table shows both rows:
     - NRA Tax Adj AVL: -713.12 (charge)
     - Cash Dividend AVL: +2377.08 (income)

4. **Net interpretation:**
   - Gross charges: 713.12 (tax)
   - Dividend credit: 2377.08
   - **Net: -1663.96 after-tax income**

### New CSV Imports

After importing CSV with new dividend/tax pairs:
- ✅ Both rows imported to DB
- ✅ Charges recomputes automatically
- ✅ Tile + tab update immediately
- ✅ Net shown correctly

## Key Differences from Earlier Versions

| Version | Dividend Treatment | Total Charges |
|---------|-------------------|---------------|
| **PR #65** (wrong) | Filtered during import ❌ | Wrong |
| **First PR #66** | Excluded from charges ❌ | 713.12 |
| **Final PR #66** | Netted as credit ✅ | **-1663.96** |

## Formula Breakdown (Live Data)

```
Fees:
  Buy MUZ commission:      0
  NRA Tax Adj:           713.12
  Total fees:            713.12

Margin Interest:         0

Dividend Income:
  Cash Dividend:      2377.08

Total Charges:
  713.12 + 0 - 2377.08 = -1663.96 (net after-tax credit)
```

## Summary

✅ **Problem:** Charges not updating after CSV import with dividend/tax rows  
✅ **Root cause:** Missing "tax" pattern, dividends not counted  
✅ **Solution:** Add "tax" to pattern, net dividends as credit  
✅ **Result:** Total charges = fees + margin - dividends = **-1663.96**  
✅ **Tests:** 8 passing with exact live data  
✅ **PR:** Minimal, focused, ready to deploy
