# Extended-Hours Pricing Fix - Demonstration

## Problem Summary

**Before Fix:** Overview page showed regular-session close prices (e.g., NVDA $238.90) during extended hours  
**After Fix:** Overview page shows extended-hours prices (e.g., NVDA $240.20) during pre-market, after-hours, and after extended-hours end

## Root Cause

The quote service in `server/quote-service.ts` was checking `meta.hasPrePostMarketData` flag before using `fulldayPrice`. Yahoo's API doesn't reliably return this flag, especially after extended-hours trading ends.

**Buggy Code (lines 144-150):**
```typescript
} else if (meta.hasPrePostMarketData && meta.fulldayPrice != null) {
  price = meta.fulldayPrice;
}
```

**Fixed Code:**
```typescript
} else {
  // Outside regular hours: prioritize fulldayPrice (includes extended-hours data)
  // Don't rely on hasPrePostMarketData flag - fulldayPrice presence is sufficient.
  price = meta.fulldayPrice ?? null;
}
```

## Test Scenarios

### Scenario 1: After Post-Market Close (Bug Report)
**Time:** 2026-10-06 07:14 UTC (~3 AM ET, after 8 PM ET close)  
**Symbol:** NVDA

**Yahoo API Response:**
```json
{
  "regularMarketPrice": 238.90,
  "fulldayPrice": 240.195,
  "hasPrePostMarketData": false,
  "previousClose": 233.95
}
```

**Before Fix:**
- Condition: `hasPrePostMarketData=false` → fails
- Falls back to `regularMarketPrice`
- Shows: $238.90 ❌

**After Fix:**
- Condition: Not regular hours + `fulldayPrice` exists → succeeds
- Uses `fulldayPrice`
- Shows: $240.195 ✓

**User Impact:** +$1.30/share difference shown

---

### Scenario 2: Active After-Hours Trading
**Time:** During post-market (4:00 PM - 8:00 PM ET)  
**Symbol:** NVDA

**Yahoo API Response:**
```json
{
  "regularMarketPrice": 238.90,
  "fulldayPrice": 240.50,
  "hasPrePostMarketData": true,
  "previousClose": 233.95
}
```

**Before Fix:** ✓ Works (hasPrePostMarketData=true)  
**After Fix:** ✓ Works (not dependent on flag)

---

### Scenario 3: Regular Trading Hours
**Time:** During market (9:30 AM - 4:00 PM ET)  
**Symbol:** NVDA

**Yahoo API Response:**
```json
{
  "regularMarketPrice": 239.50,
  "fulldayPrice": 240.50,
  "previousClose": 233.95
}
```

**Before Fix:** ✓ Uses regularMarketPrice  
**After Fix:** ✓ Uses regularMarketPrice (unchanged behavior)

---

### Scenario 4: Pre-Market Trading
**Time:** During pre-market (4:00 AM - 9:30 AM ET)  
**Symbol:** NVDA

**Yahoo API Response:**
```json
{
  "regularMarketPrice": 238.90,
  "fulldayPrice": 239.75,
  "hasPrePostMarketData": false,
  "previousClose": 233.95
}
```

**Before Fix:** Shows $238.90 ❌  
**After Fix:** Shows $239.75 ✓

---

## Code Changes

### File 1: `server/quote-service.ts`
**Lines 140-162:** Updated `fetchYahooQuote()` price selection logic

**Change:** Removed `meta.hasPrePostMarketData` check, now always uses `fulldayPrice` when outside regular hours

### File 2: `server/quotes.ts`
**Lines 200-215:** Updated `fetchYahooMeta()` for consistency

**Change:** Same logic applied to maintain consistency across the codebase

## Verification

The fix ensures:
1. ✅ During regular hours → shows `regularMarketPrice`
2. ✅ During pre-market → shows `fulldayPrice` (includes pre-market)
3. ✅ During after-hours → shows `fulldayPrice` (includes after-hours)
4. ✅ After extended hours end → shows `fulldayPrice` (last extended price)
5. ✅ Independence from `hasPrePostMarketData` flag
6. ✅ Portal-wide consistency (Holdings, Watchlist, Research)
7. ✅ Yahoo-only quotes maintained
8. ✅ 30-second refresh cadence maintained
9. ✅ Batching and subrequest limits maintained
10. ✅ Desktop layout unchanged

## API Data Flow

```
Yahoo API (includePrePost=true)
    ↓
fetchYahooQuote() [FIXED]
    ↓
persistQuotes() → marks table + watchlist_quotes table
    ↓
getWatchlistPayload() / Overview component
    ↓
User sees extended-hours prices ✓
```

## Testing

Run the test file to verify the logic:

```bash
node test-extended-hours.js
```

Expected output: All 4 tests pass ✓

## PR

Pull Request: https://github.com/karthikl6333/Seek-Track/pull/74
