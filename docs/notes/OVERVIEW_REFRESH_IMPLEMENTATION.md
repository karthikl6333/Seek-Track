# Overview Refresh Implementation

## Summary
Removed the "Open symbols" tile from the Overview stats row and added a compact global refresh button that refreshes all data sources across the site.

## Changes Made

### 1. Removed Components
- **"Open symbols" tile**: The first card showing the count of non-zero positions has been removed
- Stats row reduced from 6 cards to 5 cards

### 2. New Components
- **Global refresh button**: Circular icon button (48x48px) at the end of the stats row
- Shows `↻` when idle, `⟳` with spinning animation when refreshing
- Disabled during refresh to prevent concurrent calls

### 3. Stats Row Layout
The stats row now contains 5 cards in this order:
1. Realized P&L
2. Unrealized P&L
3. Charges
4. Paper P&L
5. Crypto P&L
+ Refresh button (trailing)

### 4. Refresh Functionality

The global refresh button calls these endpoints/functions in parallel:

#### Core Data
- **`store.refreshLiveQuotes()`**: Fetches Yahoo quotes for all open positions, calculator symbols, and pairs
- **`store.refresh()`**: Reloads trades, marks, settings, and journal from the database

#### Watchlist
- **`POST /api/watchlist/refresh`**: Refreshes quotes for all watchlist tickers

#### Paper Trading
- **`POST /api/paper/refresh`**: Refreshes paper trading account data
- Then re-fetches paper summary via `loadPaperSummary()`

#### Crypto Paper Trading
- **`POST /api/crypto-paper/refresh`**: Refreshes crypto paper trading account data
- Then re-fetches crypto summary via `loadCryptoPaperSummary()`

#### Error Handling
- Uses `Promise.allSettled()` for graceful error handling
- If one refresh fails, others still complete
- Errors logged to console but don't crash the UI

### 5. Responsive Design

#### Desktop (>1100px)
```
[Card 1] [Card 2] [Card 3] [Card 4] [Card 5] [Refresh]
```
- 5-column grid for cards
- Circular refresh button (48x48px) at the end

#### Tablet (900-1100px)
```
[Card 1] [Card 2] [Refresh]
[Card 3] [Card 4]
[Card 5]
```
- 2-column grid for cards
- Circular refresh button wraps to right

#### Mobile (<900px)
```
[Card 1]
[Card 2]
[Card 3]
[Card 4]
[Card 5]
[Refresh Button (full width)]
```
- 1-column grid for cards
- Full-width refresh button with rounded corners

## Technical Implementation

### Files Modified

#### `src/components/Overview.tsx`
- Added `refreshing` state
- Created `loadPaperAndCrypto()` helper for reusable paper/crypto fetching
- Added `refreshAll()` callback that coordinates all refresh operations
- Replaced `grid-6` layout with custom `overview-stats-row` and `overview-stats-grid`
- Removed "Open symbols" card
- Added refresh button with spinner animation

#### `src/index.css`
- Added `.overview-stats-row` class for flex container
- Added `.overview-stats-grid` class for 5-column grid
- Added `.overview-refresh-btn` class for circular button styling
- Added `@keyframes spin` animation
- Added responsive breakpoints at 1100px and 900px

### CSS Classes Added
```css
.overview-stats-row        /* Flex container for grid + button */
.overview-stats-grid       /* 5-column grid for stat cards */
.overview-refresh-btn      /* Circular refresh button */
@keyframes spin            /* Rotation animation */
```

### API Endpoints Called
1. `/api/watchlist/refresh` (POST)
2. `/api/paper/refresh` (POST)
3. `/api/crypto-paper/refresh` (POST)

### Store Methods Called
1. `store.refreshLiveQuotes()`
2. `store.refresh()`

## Build Verification

✅ TypeScript compilation passes  
✅ Client build succeeds  
✅ Server build succeeds  
✅ Cloudflare Pages build succeeds  

## Testing Checklist

- [ ] Refresh button appears correctly on desktop
- [ ] Refresh button appears correctly on tablet
- [ ] Refresh button appears correctly on mobile
- [ ] Clicking refresh updates holdings marks
- [ ] Clicking refresh updates watchlist quotes
- [ ] Clicking refresh updates paper P&L tile
- [ ] Clicking refresh updates crypto P&L tile
- [ ] Button shows spinning animation while refreshing
- [ ] Button is disabled during refresh
- [ ] Multiple rapid clicks don't cause issues
- [ ] Graceful handling if any individual refresh fails
- [ ] No console errors on refresh
- [ ] All 5 stat cards display correctly
- [ ] "Open symbols" tile is removed
- [ ] Layout is clean on all screen sizes

## Deployment Notes

- No database migrations required
- No environment variable changes required
- Compatible with existing CF Pages setup
- No breaking changes to existing functionality
- All existing features (CSV, FIFO, watchlist, paper/crypto tabs) remain intact
