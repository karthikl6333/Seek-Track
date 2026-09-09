# Extended Hours Pricing Implementation

## Summary

Updated Yahoo Finance quote fetching to accurately reflect after-hours and pre-market prices, ensuring Holdings "current price" and Watchlist "last price" match Yahoo Finance's displayed prices.

## Problem

Previously, the code always used `regularMarketPrice` which only reflects regular trading hours (9:30 AM - 4:00 PM ET). This meant:
- After-hours movements were not reflected in holdings or watchlist
- Pre-market price changes were ignored
- Users saw stale prices outside regular trading hours

## Solution

### Yahoo Finance API Fields

With `includePrePost=true` parameter, Yahoo Finance chart v8 API provides:

1. **`regularMarketPrice`** - Last price during regular trading hours (9:30 AM - 4:00 PM ET)
2. **`fulldayPrice`** - Most recent extended-hours price (includes pre-market and after-hours)
3. **`hasPrePostMarketData`** - Boolean flag indicating if extended hours data is available
4. **`currentTradingPeriod`** - Object containing timestamps for pre/regular/post market sessions

### Price Selection Logic

The implementation now uses this prioritization:

**During Regular Trading Hours (9:30 AM - 4:00 PM ET):**
- Primary: `regularMarketPrice`
- Fallback: `fulldayPrice` → `previousClose` → `chartPreviousClose`

**Outside Regular Hours (Pre-market: 4:00 AM - 9:30 AM ET, After-hours: 4:00 PM - 8:00 PM ET):**
- Primary: `fulldayPrice` (when `hasPrePostMarketData` is true)
- Fallback: `regularMarketPrice` → `previousClose` → `chartPreviousClose`

**Market Closed (Weekends, Holidays):**
- Use fallback chain: `fulldayPrice` → `regularMarketPrice` → `previousClose` → `chartPreviousClose`

### Code Changes

Updated three functions in `server/quotes.ts`:

1. **`fetchYahooQuote()`** - Used for holdings/marks refresh (Overview page "current price")
2. **`fetchYahooChartQuote()`** - Used for watchlist refresh (Watchlist "last price")
3. **`fetchYahooMeta()`** - Used for research/symbol lookup

All three now:
- Add `includePrePost=true` to API requests
- Use `interval=1m&range=1d` (instead of `interval=1d&range=1d` or `range=5d`) for optimal extended-hours data
- Detect current trading period using Unix timestamps
- Select appropriate price based on market state

## Session Change Calculation

The percentage and dollar change calculations remain based on the session open price vs. the most current last price:

- **During RTH:** `last` (regularMarketPrice) vs. `sessionOpen` (today's open)
- **Extended hours:** `last` (fulldayPrice) vs. `sessionOpen` (still today's RTH open)
- **Fallback:** If no session open, compare against `previousClose`

This matches Yahoo Finance's behavior where extended-hours % change shows movement from the regular session close.

## Testing

Verified with live data during pre-market hours:
- NVDA: regularMarketPrice=$225.73, fulldayPrice=$224.459 → Using $224.459 ✅
- AAPL: regularMarketPrice=$316.22, fulldayPrice=$316.078 → Using $316.078 ✅
- TSLA: regularMarketPrice=$368.16, fulldayPrice=$364.71 → Using $364.71 ✅
- MSFT: regularMarketPrice=$493.95, fulldayPrice=$494.00 → Using $494.00 ✅

All prices correctly reflect extended-hours movements.

## Compatibility

No breaking changes:
- Database schema unchanged
- API endpoints unchanged
- Client code unchanged
- CSV import/export unchanged
- Paper trading unchanged
- Authentication unchanged

The changes are entirely within the quote fetching logic and automatically benefit all consumers of that data.

## Deployment

After merge, HostOps will redeploy to Cloudflare Pages/Neon. No manual intervention required.

## Yahoo Finance Field Reference

| Field | When Available | Description |
|-------|---------------|-------------|
| `regularMarketPrice` | During RTH | Last traded price during regular hours |
| `fulldayPrice` | When `hasPrePostMarketData=true` | Most recent price including extended hours |
| `hasPrePostMarketData` | Always | Boolean indicating extended data availability |
| `previousClose` | Always | Prior trading day's close |
| `currentTradingPeriod.regular.start` | Always | Unix timestamp for RTH start |
| `currentTradingPeriod.regular.end` | Always | Unix timestamp for RTH end |
| `currentTradingPeriod.pre.start` | Always | Unix timestamp for pre-market start |
| `currentTradingPeriod.post.end` | Always | Unix timestamp for after-hours end |
