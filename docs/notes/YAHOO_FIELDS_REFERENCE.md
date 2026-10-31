# Yahoo Finance API Fields Reference

## Extended Hours Pricing Fields

### Price Fields (Preferred Order)

1. **`fulldayPrice`** (number | undefined)
   - Most recent price including extended hours (pre-market and after-hours)
   - Available when `hasPrePostMarketData` is true
   - Updates during pre-market (4:00 AM - 9:30 AM ET) and after-hours (4:00 PM - 8:00 PM ET)
   - This is Yahoo Finance's "current" price shown on their website outside regular hours
   - **Example:** NVDA shows $224.459 when regularMarketPrice is $225.73

2. **`regularMarketPrice`** (number | undefined)
   - Last traded price during regular trading hours (9:30 AM - 4:00 PM ET)
   - Always available during and after regular hours
   - Does NOT update during extended hours
   - **Use case:** Primary price during regular hours

3. **`previousClose`** (number | undefined)
   - Prior trading day's closing price
   - Always available
   - **Use case:** Fallback when no current price available

4. **`chartPreviousClose`** (number | undefined)
   - Alternative previous close field
   - **Use case:** Final fallback

### Market State Detection Fields

1. **`hasPrePostMarketData`** (boolean | undefined)
   - Indicates if extended hours data is available for this symbol
   - When true, `fulldayPrice` should be preferred outside regular hours
   - Some symbols (e.g., mutual funds, some ETFs) don't have extended hours trading

2. **`currentTradingPeriod`** (object)
   - Contains Unix timestamps for different market sessions
   - Structure:
     ```typescript
     {
       pre: { start: number, end: number },      // Pre-market window
       regular: { start: number, end: number },  // Regular hours window
       post: { start: number, end: number }      // After-hours window
     }
     ```
   - **Use case:** Determine which session we're currently in

3. **`regularMarketTime`** (number | undefined)
   - Unix timestamp of the last regular market trade
   - Not used in current implementation but available

### Session Change Fields

1. **`regularMarketChangePercent`** (number | undefined)
   - Percentage change during regular hours
   - May not reflect extended hours movements
   - **Note:** We calculate our own change % to include extended hours

2. **Session open price**
   - Extracted from `indicators.quote[0].open` array
   - Used to calculate intraday change
   - Found by matching `timestamp` array with `currentTradingPeriod.regular.start`

## API Request Parameters

### Required for Extended Hours Data

```
https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?interval=1m&range=1d&includePrePost=true
```

**Key parameters:**
- `interval=1m` - Minute-level data (captures latest extended hours prices)
- `range=1d` - Today's data (sufficient for current price)
- `includePrePost=true` - **CRITICAL** - Enables extended hours fields in response

### Alternative Intervals (Not Recommended for Real-time Prices)

- `interval=1d` - Daily bars only, may not show latest extended hours price
- `interval=5m` - 5-minute bars, slightly delayed
- `range=5d` - Multiple days, unnecessary bandwidth for current price

## Market Hours (Eastern Time)

- **Pre-market:** 4:00 AM - 9:30 AM
- **Regular hours:** 9:30 AM - 4:00 PM
- **After-hours:** 4:00 PM - 8:00 PM

**Note:** Not all symbols trade in extended hours. Always check `hasPrePostMarketData`.

## Implementation Example

```typescript
const now = Math.floor(Date.now() / 1000);
const regularStart = meta.currentTradingPeriod?.regular?.start;
const regularEnd = meta.currentTradingPeriod?.regular?.end;
const isRegularHours = 
  regularStart != null && 
  regularEnd != null && 
  now >= regularStart && 
  now < regularEnd;

let price: number | null = null;

if (isRegularHours) {
  // During regular hours, use regularMarketPrice
  price = meta.regularMarketPrice ?? null;
} else if (meta.hasPrePostMarketData && meta.fulldayPrice != null) {
  // Outside regular hours with extended data, use fulldayPrice
  price = meta.fulldayPrice;
}

// Fallback chain for all scenarios
if (price === null || !Number.isFinite(price)) {
  price = 
    meta.fulldayPrice ?? 
    meta.regularMarketPrice ?? 
    meta.previousClose ?? 
    meta.chartPreviousClose ?? 
    null;
}
```

## Yahoo Finance Website Comparison

To verify our implementation matches Yahoo Finance:

1. Visit https://finance.yahoo.com/quote/NVDA during pre-market or after-hours
2. Note the displayed price (e.g., $224.459)
3. Our implementation should return the same value
4. The regular market close will be shown separately (e.g., "At close: $225.73")

## Common Pitfalls

❌ **Don't do this:**
```typescript
// Always using regularMarketPrice
const price = meta.regularMarketPrice ?? meta.previousClose;
```
**Problem:** Ignores extended hours movements

❌ **Don't do this:**
```typescript
// Always using fulldayPrice
const price = meta.fulldayPrice ?? meta.regularMarketPrice;
```
**Problem:** During regular hours, fulldayPrice might lag behind regularMarketPrice

✅ **Do this:**
```typescript
// Smart selection based on market state
if (isRegularHours) {
  price = meta.regularMarketPrice;
} else if (hasExtendedData) {
  price = meta.fulldayPrice;
}
// ... with fallbacks
```

## Resources

- [Yahoo Finance API v8 Chart endpoint](https://query1.finance.yahoo.com/v8/finance/chart/)
- No official documentation, but widely used in financial apps
- Rate limiting: ~2000 requests/hour (no auth required for public data)
- User-Agent recommended to avoid potential blocking
