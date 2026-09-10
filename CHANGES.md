# UI Improvements Summary

## PR #21: Densify Watchlist & Move Global Refresh

### 1. Watchlist Side Panel Densification

**Spacing Changes:**
- Cell padding: `4px 6px` → `2px 4px`
- Font size: `11px` → `10px`
- Line height: `1.2` → `1.1`
- Card padding: `10px` → `8px`
- Toolbar gaps: `8px` → `6px` (main) and `4px` (controls)
- Input/button heights: `32px` → `28px`
- Remove × button: `28px` → `24px`

**Files Modified:**
- `src/App.css` - Updated `.watchlist-side` styles
- `src/components/Watchlist.tsx` - Updated remove button sizing

**What's Preserved:**
- All sorting functionality
- Add/Refresh buttons
- 52-week high/low columns
- Color styling (gains/losses)
- Remove button usability (~24px click target)

---

### 2. Global Refresh Button Relocation

**Changes:**
- **Removed:** "trades persisted" badge from `App.tsx` header
- **Added:** Global refresh button in header (available on all tabs)
- **Lifted:** `refreshAll` logic from `Overview.tsx` to `App.tsx`
- **Removed:** Duplicate refresh button from Overview stats row

**Where Refresh Lives Now:**
- Location: App header (`src/App.tsx` topbar)
- Availability: All tabs (Overview, Positions, Trades, Journal, etc.)
- Style: Compact circular icon (↻ / ⟳), 40×40px, dark theme

**Refresh Functionality:**
Triggers parallel refresh of:
1. Schwab holdings quotes (`store.refreshLiveQuotes()`)
2. Store data (`store.refresh()`)
3. Watchlist quotes (`/api/watchlist/refresh`)
4. Paper trading data (`refreshPaperData()`)
5. Crypto paper data (`refreshCryptoPaperLivePnl()`)

**Files Modified:**
- `src/App.tsx` - Added refresh button, lifted refresh logic
- `src/components/Overview.tsx` - Removed local refresh, accepts `onRefreshAll` prop

---

## Branch: `cursor/densify-watchlist-move-refresh-4039`
## Commit: c6fbff0
## PR: https://github.com/karthikl6333/Seek-Track/pull/21
