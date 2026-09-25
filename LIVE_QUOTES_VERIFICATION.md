# Live Quote Streaming - Verification Guide

## Overview

This PR replaces the Overview watchlist's 15-30 second polling refresh with live Server-Sent Events (SSE) streaming, delivering real-time price updates like a modern trading app.

## What Changed

### Server (SSE)

**New endpoint:** `GET /api/quotes/stream`
- Server-Sent Events (SSE) stream pushing quote updates
- Shared refresh loop: one Yahoo fetch every ~3 seconds fans out to all connected clients
- Auto teardown: Yahoo refresh stops when last connection closes (saves quota)
- Universe: same symbols as regular refresh (holdings + watchlist + research)
- HTTP Basic Auth maintained for EventSource

**Files:**
- `server/quote-stream.ts` - New SSE streaming implementation
- `server/index.ts` - Registered SSE endpoint

### Client

**Live quotes hook:** `src/hooks/useLiveQuotes.ts`
- Manages EventSource connection lifecycle
- Auto-reconnect on connection loss (3s backoff)
- Gracefully closes when disabled

**UI changes:**
- Live/Delayed badge in app header (green = live connected, yellow = connecting, gray = delayed)
- Live On/Off toggle button (persisted to `localStorage.seektrack.liveQuotes`, default ON)
- Manual refresh button works in both modes
- Removed misleading "auto-refresh: 30s" text from Overview and Watchlist

**Integration:**
- `src/App.tsx` - Live toggle, SSE integration, conditional auto-refresh
- `src/hooks/useStore.ts` - New `applyMarksUpdate()` method for live updates
- When live ON: SSE streaming active, 30s polling disabled
- When live OFF: SSE closed, falls back to 30s `setInterval` polling

## Verification Steps

### 1. Stream is Live

```bash
# Start the server
npm run dev

# Open browser to http://localhost:3000
# Log in with credentials
```

**Expected:**
- Topbar shows green `● Live` badge
- Holdings and watchlist prices update every ~3 seconds
- No visible page refresh or loading states
- Console logs: `[LiveQuotes] Connected: {id, timestamp, refreshInterval}`

### 2. Toggle Behavior

**Live OFF:**
1. Click `Live Off` button in topbar
2. Badge changes to gray `Delayed`
3. Console logs: `[App] Auto-refresh enabled (live quotes disabled)`
4. Prices update every 30 seconds (poll-based)

**Live ON:**
1. Click `Live On` button in topbar
2. Badge changes to yellow `○ Connecting`, then green `● Live`
3. Console logs: `[LiveQuotes] Connecting to SSE stream...`
4. Prices resume ~3s streaming updates

### 3. Teardown When All Tabs Close

**Server-side logs:**
```bash
# Open Overview page (first tab)
[QuoteStream] New connection: sse-1234567890-abc123
[QuoteStream] Active connections: 1
[QuoteStream] Starting refresh loop (3000ms interval)

# Open second tab
[QuoteStream] New connection: sse-9876543210-xyz789
[QuoteStream] Active connections: 2

# Close first tab
[QuoteStream] Connection closed: sse-1234567890-abc123 (1 remaining)

# Close second tab
[QuoteStream] Connection closed: sse-9876543210-xyz789 (0 remaining)
[QuoteStream] Stopped refresh loop (no active connections)
```

**Verification:**
- Yahoo refresh only runs when ≥1 client connected
- No phantom loops wasting Yahoo quota
- Refresh resumes immediately when new tab opens

### 4. Manual Refresh Works in Both Modes

**Live ON (SSE active):**
- Click circular refresh button (↻)
- Button shows spinner + checkmark animation
- Prices update immediately
- SSE stream continues in background

**Live OFF (polling):**
- Click circular refresh button (↻)
- Button shows spinner + checkmark animation
- Prices update immediately
- Next auto-refresh in 30s

### 5. Cross-Tab Persistence

1. Enable Live quotes → badge shows `● Live`
2. Open new tab → badge shows `● Live` (localStorage restored)
3. Disable Live quotes → badge shows `Delayed`
4. Open new tab → badge shows `Delayed` (localStorage restored)

### 6. Auth Still Works

**EventSource respects HTTP Basic Auth:**
```javascript
// Browser automatically includes auth credentials
const es = new EventSource('/api/quotes/stream');
```

**Test:**
1. Open private/incognito window
2. Navigate to Overview
3. Enter credentials at Basic Auth prompt
4. SSE stream connects successfully (green `● Live` badge)

### 7. Reconnect on Connection Loss

**Simulate network issue:**
```bash
# Kill server mid-stream
# Client detects error, shows yellow "○ Connecting"
# Restart server
# Client reconnects after 3s, shows green "● Live"
```

**Console logs:**
```
[LiveQuotes] Connection error, will retry...
[LiveQuotes] Connecting to SSE stream...
[LiveQuotes] Connected: {id, timestamp, ...}
```

## Performance Notes

### Before (Polling)
- 30-second `setInterval` for all tabs
- Each tab makes independent HTTP requests
- 50 symbols = 6 chunked requests every 30s per tab
- Holdings and watchlist stale for up to 30s

### After (SSE Streaming)
- Single shared server loop (~3s interval) when ≥1 client connected
- One Yahoo fetch → broadcast to all tabs
- 50 symbols = 6 chunked refreshes every 3s (shared across all clients)
- Holdings and watchlist always fresh (<3s latency)
- Zero Yahoo requests when no clients connected (teardown)

### Cloudflare Workers Compatibility

**SSE on CF Pages/Workers:**
- ✅ SSE works on CF Workers/Pages (standard HTTP response)
- ✅ No WebSocket (avoids CF WebSocket limits)
- ✅ No Durable Objects required (Node.js Map tracks connections)
- ⚠️ Note: CF Workers have 50 subrequest limit per request
  - This PR reuses existing chunking (10 symbols per refresh call)
  - SSE endpoint itself = 1 long-lived response (not counted per-message)

**For production CF deployment:**
- SSE stream works as-is (standard HTTP response)
- Shared refresh loop runs in Worker memory (ephemeral, restarts on cold boot)
- If multi-isolate coordination needed, consider CF Durable Objects (optional future enhancement)

## Files Changed

### New Files
- `server/quote-stream.ts` - SSE streaming implementation
- `src/hooks/useLiveQuotes.ts` - Client-side SSE hook

### Modified Files
- `server/index.ts` - SSE endpoint registration
- `src/App.tsx` - Live toggle, SSE integration, conditional polling
- `src/hooks/useStore.ts` - `applyMarksUpdate()` method
- `src/components/Overview.tsx` - Removed "auto-refresh: 30s" text
- `src/components/Watchlist.tsx` - Removed "auto-refresh: 15s" text

## Rollback Plan

If issues arise in production:

1. **Disable live quotes by default:**
   ```typescript
   // src/App.tsx
   const [liveQuotesEnabled, setLiveQuotesEnabled] = useState(() => {
     return false; // Change from true to false
   });
   ```

2. **Remove SSE endpoint:**
   ```typescript
   // server/index.ts
   // Comment out: app.get('/api/quotes/stream', handleQuoteStream);
   ```

3. Users can still manually toggle "Live On" if desired, or leave on "Delayed" (30s polling)

## Future Enhancements (Out of Scope)

- Per-symbol refresh cadence (hot vs cold tiers)
- Configurable streaming interval (3s vs 5s vs 10s)
- Desktop notifications on price alerts
- SSE for news signals (currently separate 5min poll)
- CF Durable Objects for multi-isolate coordination (if needed)

## Testing Checklist

- [x] TypeScript compilation passes
- [x] Client build succeeds
- [x] Server build succeeds
- [ ] Local dev server: SSE connects and streams
- [ ] Live toggle persists across page reloads
- [ ] Teardown when last tab closes (check server logs)
- [ ] Manual refresh works in both modes
- [ ] Auth prompt works in private window
- [ ] Reconnect after simulated network loss
- [ ] Multiple tabs share same server refresh loop
- [ ] Cloudflare Pages deployment compatible
