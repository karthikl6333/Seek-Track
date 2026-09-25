# Live Quote Streaming - Verification Guide

## Overview

This PR implements SSE-based live quote streaming with **Cloudflare Workers lifetime budget safety**, replacing the 15-30 second polling refresh with real-time updates (~3s latency).

## What Changed from PR #57 (Production Fix)

### **Problem: CF Workers Lifetime Subrequest Budget**

**Critical misunderstanding in PR #55, #56, #57:**
- CF Workers subrequest budget is **per Worker invocation for entire lifetime**
- NOT reset per tick/loop iteration
- Long-lived SSE = 1 Worker invocation = ALL ticks share SAME 50 subrequest budget

**PR #57 failure on production (4bb8bf6):**
```
Tick 1: Sent marks (22 symbols, refreshed) ← works
Tick 2-3: Sent marks (22 symbols, refreshed) ← works
Tick 4+: Too many subrequests → NeonDbError → Failed to send marks
Client reconnect storm every ~3-4s
```

**Why it failed:**
- Each tick: getLiveStreamUniverse + refreshLiveQuotes + listMarksDetailed
- 22 symbols ÷ 10 = 3 chunks × 12 subrequests = ~36 subrequests per tick
- Tick 1: 36 used (14 remaining)
- Tick 2: 36 used (budget exhausted, error)
- Even "smaller universe" couldn't escape lifetime accumulation

### **Solution: Decouple Refresh from SSE Worker**

New implementation (this PR):

**A) Short-lived refresh endpoint** - `POST /api/quotes/live-refresh`
- Fresh 50 subrequest budget per invocation
- Stampede guard: skip if last refresh < 3s ago
- Limited universe: holdings + watchlist (~20-40 symbols)
- Writes to marks table

**B) Read-only SSE loop** - `GET /api/quotes/stream`
- Only reads marks from DB (~1 subrequest per tick)
- Kicks refresh every 3rd tick (~1/3 subrequest avg per tick)
- Total: ~1.33 subrequests per tick × 18 ticks = ~24 subrequests
- Graceful close after 18 ticks (~54 seconds)
- Client EventSource auto-reconnects with fresh budget

**Why it works:**
1. ✅ Yahoo refresh in separate Worker (fresh 50 budget each POST)
2. ✅ SSE only reads DB + occasional kick (cheap: ~1.33 subrequests per tick)
3. ✅ Graceful close after 18 ticks (~54s) → auto-reconnect → fresh budget
4. ✅ No "Too many subrequests" errors
5. ✅ Stable streaming with controlled reconnects (~every minute)

## Architecture

### Before (PR #55 - Failed on CF)
```
┌─────────────────────────────────────────────────┐
│  Shared setInterval (outside stream)            │
│  └─ CF Workers: "hung, no response" → killed    │
└─────────────────────────────────────────────────┘
```

### After (This PR - CF Compatible)
```
┌─────────────────────────────────────────────────┐
│  Browser Tab 1          Browser Tab 2           │
│  ↓ EventSource          ↓ EventSource           │
└──────────────────┬──────────────────────────────┘
                   │
         ┌─────────▼─────────┐
         │  SSE Endpoint     │
         │  /api/quotes/stream│
         └─────────┬─────────┘
                   │
         ┌─────────▼────────────────────────┐
         │ Per-Connection Async Loop        │
         │ (inside ReadableStream)          │
         │                                  │
         │ while (!closed) {                │
         │   await sleep(3s)                │
         │   fetch Yahoo + update DB        │
         │   enqueue marks event            │
         │   enqueue heartbeat              │
         │ }                                │
         └──────────────────────────────────┘
```

## Verification Steps

### 1. Stream Works Without "Too Many Subrequests"

**CF-specific checks:**
```bash
# Deploy to CF Pages
# Open browser DevTools → Network tab
# Filter: /api/quotes/stream
```

**Expected (CF Workers production):**
- ✅ Status: `200`
- ✅ Type: `text/event-stream`
- ✅ **EventStream tab shows many `event: marks`** (~18 over ~54 seconds)
- ✅ **NO "Too many subrequests" errors** in CF logs ← KEY FIX
- ✅ **Controlled reconnect** after ~54s (graceful, not error storm)
- ✅ After reconnect: stream continues with fresh budget

**EventStream tab should show:**
```
event: connected
data: {"id":"sse-...","timestamp":"...","tickInterval":3000,"maxTicks":18}

event: marks
data: {"marks":{...},"lastRefreshAt":"..."}

: heartbeat ...

event: marks
...

(repeats ~18 times over ~54 seconds)

[Stream closes gracefully]
[EventSource auto-reconnects]

event: connected
data: {"id":"sse-..."}

event: marks
...
```

**Server logs (CF Pages Functions):**
```
[QuoteStream] New connection: sse-abc123
[QuoteStream] Starting read-only stream loop for sse-abc123
[QuoteStream] sse-abc123: Refresh completed (22 symbols)
[QuoteStream] sse-abc123: Sent marks (tick 1/18)
[QuoteStream] sse-abc123: Sent marks (tick 2/18)
[QuoteStream] sse-abc123: Sent marks (tick 3/18)
[QuoteStream] sse-abc123: Refresh skipped (recent)
[QuoteStream] sse-abc123: Sent marks (tick 4/18)
...
[QuoteStream] sse-abc123: Sent marks (tick 18/18)
[QuoteStream] sse-abc123: Gracefully closing after 18 ticks (lifetime budget preservation)
[QuoteStream] sse-abc123: Stream ended (18 ticks)

[LiveRefresh] Refreshing 22 symbols
[LiveRefresh] Completed: 22 updated, 0 failed
```

**NOT expected:**
- ❌ "Too many subrequests" errors
- ❌ NeonDbError after a few ticks
- ❌ Reconnect storm every 3-4s (error-driven)
- ❌ Only 1-2 marks events then silence

### 2. Prices Update Every ~3s (No Manual Refresh)

**Test:**
1. Open Overview page
2. Note current price (e.g., AAPL: $178.23)
3. Wait 3 seconds (no clicking)
4. Price updates (e.g., AAPL: $178.25)
5. Wait 3 more seconds
6. Price updates again

**Expected:**
- ✅ Holdings table updates automatically
- ✅ Watchlist sidebar updates automatically
- ✅ No visible "Refreshing..." states
- ✅ Green `● Live` badge stays connected

### 3. Toggle Behavior

**Live OFF:**
1. Click `Live Off` button
2. Badge: gray `Delayed`
3. Network tab: `/api/quotes/stream` request cancelled
4. Prices update every 30s (poll-based)
5. Console: `[App] Auto-refresh enabled (live quotes disabled)`

**Live ON:**
1. Click `Live On` button
2. Badge: yellow `○ Connecting` → green `● Live`
3. Network tab: new `/api/quotes/stream` request starts
4. Prices resume ~3s updates
5. Console: `[LiveQuotes] Connected: {id, timestamp, ...}`

### 4. Manual Refresh Works in Both Modes

**Live ON (SSE active):**
- Click circular refresh button (↻)
- Button shows spinner + checkmark
- Prices update immediately
- SSE stream continues in background
- Next automatic update in ~3s

**Live OFF (polling):**
- Click circular refresh button (↻)
- Button shows spinner + checkmark
- Prices update immediately
- Next automatic update in 30s

### 5. Connection Lifecycle

**Open tab:**
```
[QuoteStream] New connection: sse-abc123
[QuoteStream] Starting stream loop for sse-abc123
```

**Close tab:**
```
[QuoteStream] Connection cancelled: sse-abc123
[QuoteStream] Stream ended for sse-abc123
```

**Network error / reconnect:**
```
[LiveQuotes] Connection error, will retry...
[LiveQuotes] Connecting to SSE stream...
[QuoteStream] New connection: sse-xyz789
[LiveQuotes] Connected: {id, timestamp, ...}
```

### 6. Multi-Tab Behavior

**Note:** Each tab has its own SSE connection (CF isolate-safe design).

**Test:**
1. Open Overview in Tab 1
2. Open Overview in Tab 2
3. Server logs show 2 connections
4. Both tabs update every ~3s (independently)
5. Close Tab 1 → server logs show 1 connection
6. Close Tab 2 → server logs show 0 connections

**Yahoo quota:**
- Each connection makes ~20 fetches/minute (60s / 3s = 20)
- 2 tabs = ~40 fetches/minute
- Yahoo limit: ~1000 fetches/minute
- Safe for typical 1-5 concurrent users

### 7. Auth Still Works

**EventSource respects HTTP Basic Auth:**
1. Open private/incognito window
2. Navigate to Overview
3. Enter credentials at Basic Auth prompt
4. SSE stream connects successfully
5. Green `● Live` badge appears
6. Prices update every ~3s

### 8. Cloudflare Workers Subrequest Limits

**Per-connection budget:**
- Universe query: 1 subrequest
- 50 symbols ÷ 10 per chunk = 5 refresh calls
- Each refresh: 10 Yahoo + 2 Neon = 12 subrequests
- **Total per cycle: 1 + (5 × 12) = 61 subrequests**

⚠️ **Exceeds CF free tier 50 limit per request**

**Mitigation (already implemented):**
- Connection loop is long-lived (not per-request)
- Each cycle is internal to the stream (doesn't count as separate request)
- CF counts subrequests during stream as part of the initial request budget
- If needed, reduce symbol count or increase chunk size

**Monitoring:**
- Watch CF Pages Functions logs for "Too many subrequests" errors
- If errors occur, reduce `STREAM_REFRESH_INTERVAL_MS` to 5s or 10s
- Or implement intelligent batching (skip symbols with recent updates)

## Performance Notes

### Per-Connection Loop (This Design)

**Pros:**
- ✅ CF Workers compatible (no hang detector issues)
- ✅ Simple implementation (no Durable Objects needed)
- ✅ Auto teardown (loop stops when connection closes)
- ✅ Works on Node.js dev and CF production

**Cons:**
- ⚠️ Each connection makes its own Yahoo fetches
- ⚠️ Yahoo quota scales with concurrent users
- ⚠️ Not ideal for hundreds of concurrent users

**Mitigation:**
- 3s interval (conservative quota)
- Typical deployment: 1-5 concurrent users
- Yahoo limit: ~1000 req/min (supports ~50 concurrent streams at 3s interval)

### Alternative (Not Implemented)

**Durable Object shared loop:**
- ✅ One Yahoo fetch shared across all isolates
- ❌ Requires CF paid plan ($5/month)
- ❌ More complex (DO state, RPC coordination)
- ❌ Overkill for typical 1-5 user deployment

**Future enhancement if needed:** If deployment grows to 50+ concurrent users, consider Durable Object-based shared refresh.

## Rollback Plan

If issues arise:
1. **User-level**: Click "Live Off" to revert to 30s polling
2. **Code-level**: Change default to OFF in `src/App.tsx`
3. **Server-level**: Comment out SSE endpoint in `server/index.ts`

## Scope

✅ **Live streaming (SSE):**
- Overview holdings table
- Overview watchlist sidebar

⚠️ **Manual refresh only (not live streamed):**
- Research tab quotes (too many symbols, hits CF subrequest limits)
- Reason: Full research universe (~50-97 symbols) exceeds CF 50 subrequest limit
- Workaround: Click manual refresh button on Research tab

❌ **Out of scope (unchanged):**
- News signals (separate ~5 min polling)
- Paper trading refresh
- CSV import

## Files Changed

### Modified
- `server/quote-stream.ts` - Rewritten for CF Workers compatibility
- `LIVE_QUOTES_VERIFICATION.md` - Updated with CF-specific checks

### Unchanged
- `src/hooks/useLiveQuotes.ts` - Client-side logic (no changes needed)
- `src/App.tsx` - Live toggle (no changes needed)
- `src/hooks/useStore.ts` - Store integration (no changes needed)

## Testing Checklist (CF Pages Production)

- [x] TypeScript compilation passes
- [x] Client build succeeds
- [x] Server build succeeds
- [ ] **CF Pages deploy**: SSE connects without hang errors
- [ ] **Network tab**: Periodic `marks` events visible
- [ ] **Prices update**: Every ~3s without manual refresh
- [ ] **Live toggle**: ON/OFF switches correctly
- [ ] **Multi-tab**: Both tabs update independently
- [ ] **Manual refresh**: Works in both modes
- [ ] **Auth**: Works in private/incognito windows
- [ ] **Logs**: No "hung and would never generate a response"

## Next Steps

1. Merge this PR
2. Deploy to CF Pages production
3. Verify `marks` events arrive in Network tab
4. Monitor CF Pages Functions logs for errors
5. Collect user feedback on latency

## Key Differences from PR #55

| Aspect | PR #55 (Failed) | This PR (Fixed) |
|--------|-----------------|-----------------|
| **Loop location** | Outside stream (`setInterval`) | Inside stream (async `while`) |
| **CF compatibility** | ❌ Hang detector killed stream | ✅ Continuous response bytes |
| **Marks events** | ❌ Never arrived | ✅ Every ~3s |
| **Connection state** | Killed after ~3s | Stays open indefinitely |
| **Shared loop** | Attempted (failed on CF) | Per-connection (CF-safe) |
| **Yahoo quota** | Would be shared | Per-connection |
| **Complexity** | Medium (shared state) | Low (isolated loops) |
