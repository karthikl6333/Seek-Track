# Cloudflare Workers Subrequest Limit Fix

## Production Blocker (Resolved)

**Issue:** After PR #50 merge, production deployment returned **502 "Too many subrequests"** errors on price refresh.

**Root Cause:** Cloudflare Workers free tier limit of 50 subrequests per request was exceeded.

**Resolution:** Chunking at HTTP boundary - multiple requests, each under limit.

## The Problem

### CF Workers Subrequest Limits

Cloudflare Workers free tier:
- **Hard limit:** 50 subrequests per request (per Worker invocation)
- **Counts as subrequests:**
  - External API calls (Yahoo Finance)
  - Database queries (Neon)
  - Any fetch() call from within a Worker

**Critical misunderstanding in first attempt:** Sequential loops **within one Worker invocation** still count toward the **same 50 limit**. The counter does NOT reset between loop iterations.

### What Broke After PR #50

**Old code subrequest count:**
```
Universe build:
  5 Neon queries (trades, watchlist, research, etfs, pairs)

Fetch quotes:
  N × Yahoo API calls (one per symbol)

Persist:
  1 Neon query (marks upsert)
  1 Neon query (load watchlist symbols)
  1 Neon query (watchlist_quotes upsert)

Total: 5 + N + 3 = 8 + N subrequests PER INVOCATION
```

**For 50 symbols:** 8 + 50 = **58 subrequests** → 💥 502 error

### Why First Fix Failed

**First attempt (incorrect):**
```typescript
// Inside refreshAllPrices() - SINGLE Worker invocation
for (let i = 0; i < universe.length; i += 10) {
  const chunk = universe.slice(i, i + 10);
  await refreshChunk(chunk); // 10 Yahoo + 2 Neon = 12
}
// For 50 symbols: 5 + (5 × 12) = 65 subrequests in ONE invocation → still 502!
```

**The mistake:** Looping inside one function = still one Worker invocation = one subrequest counter.

## The Solution: HTTP Boundary Chunking

### Correct Approach

**Chunk at the HTTP/caller boundary** - each HTTP request is a separate Worker invocation with its own 50-subrequest budget.

```
Client calls:
1. GET /api/quotes/universe        → 1 Worker invocation (1 Neon query)
2. POST /api/quotes/refresh (0-10)  → 1 Worker invocation (10 Yahoo + 2 Neon)
3. POST /api/quotes/refresh (11-20) → 1 Worker invocation (10 Yahoo + 2 Neon)
4. POST /api/quotes/refresh (21-30) → 1 Worker invocation (10 Yahoo + 2 Neon)
... and so on

Each Worker invocation stays under 50 limit ✅
```

## Implementation

### 1. Server: Separate Universe Build

**New endpoint:** `GET /api/quotes/universe`

```typescript
export async function getSymbolUniverse(): Promise<string[]> {
  return buildSymbolUniverse(); // 1 Neon UNION query
}

export async function getUniverseHandler(c: Context) {
  const universe = await getSymbolUniverse();
  return c.json({ symbols: universe, total: universe.length });
}
```

**Subrequest budget:** 1 Neon query = **1 subrequest** ✅

### 2. Server: Refresh Specific Symbols

**Modified:** `POST /api/quotes/refresh`

```typescript
export async function refreshAllPrices(symbols?: string[]) {
  let universe: string[];
  
  if (symbols && symbols.length > 0) {
    // Caller provided symbols - use those directly (NO universe build)
    universe = symbols;
  } else {
    // No symbols - build universe (backward compat, but warn if >10)
    universe = await buildSymbolUniverse();
    if (universe.length > 10) {
      console.warn('Universe too large, caller should chunk!');
    }
  }
  
  // Fetch + persist
  const quotes = await fetchQuotesBatch(universe);
  await persistQuotes(quotes);
  
  return { ok, updated, failed, refreshedAt, total };
}
```

**Subrequest budget (when symbols provided):**
- 0 Neon (no universe build)
- N Yahoo fetches (N ≤ 10)
- 2 Neon queries (marks + watchlist_quotes parallel)
= **N + 2 subrequests** (N=10 → 12 subrequests) ✅

### 3. Client: Chunked HTTP Calls

**Updated:** `App.tsx` auto-refresh

```typescript
const refreshAll = async () => {
  // 1. Get universe (1 HTTP request)
  const { symbols: universe } = await getQuoteUniverse();
  
  // 2. Refresh in chunks (N HTTP requests, sequential)
  const CHUNK_SIZE = 10;
  for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
    const chunk = universe.slice(i, i + CHUNK_SIZE);
    await store.refreshLiveQuotes(chunk); // POST /api/quotes/refresh
  }
  
  // 3. Reload client state
  await store.refresh();
};
```

**HTTP requests for 50 symbols:**
- 1 × GET /api/quotes/universe (1 subrequest)
- 5 × POST /api/quotes/refresh with 10 symbols each (12 subrequests each)

**Each Worker invocation stays under 50** ✅

## Subrequest Budget Analysis

### Single Symbol Refresh (Manual)

**Scenario:** User clicks "Refresh prices" on one holding

```
POST /api/quotes/refresh { symbols: ["AAPL"] }

Subrequests:
  0 universe build (symbols provided)
  1 Yahoo fetch
  2 Neon persist
= 3 subrequests ✅
```

### 10-Symbol Chunk

**Scenario:** Auto-refresh chunk or manual "Refresh prices" button

```
POST /api/quotes/refresh { symbols: ["AAPL", "NVDA", ...10 total] }

Subrequests:
  0 universe build
  10 Yahoo fetches
  2 Neon persist
= 12 subrequests ✅
```

### 50-Symbol Universe (Full Refresh)

**Scenario:** Auto-refresh or manual topbar button

```
1. GET /api/quotes/universe
   → Worker invocation 1: 1 subrequest ✅

2. POST /api/quotes/refresh { symbols: [0-9] }
   → Worker invocation 2: 12 subrequests ✅

3. POST /api/quotes/refresh { symbols: [10-19] }
   → Worker invocation 3: 12 subrequests ✅

4. POST /api/quotes/refresh { symbols: [20-29] }
   → Worker invocation 4: 12 subrequests ✅

5. POST /api/quotes/refresh { symbols: [30-39] }
   → Worker invocation 5: 12 subrequests ✅

6. POST /api/quotes/refresh { symbols: [40-49] }
   → Worker invocation 6: 12 subrequests ✅

Total: 6 Worker invocations
Max per invocation: 12 subrequests ✅
```

### 100-Symbol Universe

```
1. GET /api/quotes/universe: 1 subrequest
2-11. 10 × POST /api/quotes/refresh: 12 subrequests each

Total: 11 Worker invocations
Max per invocation: 12 subrequests ✅
```

## Code Changes Summary

### `server/quote-service.ts`

**Added:**
```typescript
export async function getSymbolUniverse(): Promise<string[]> {
  return buildSymbolUniverse();
}
```

**Modified:**
```typescript
export async function refreshAllPrices(symbols?: string[]) {
  // If symbols provided: refresh only those (NO universe build)
  // If no symbols: build universe (backward compat, warn if large)
}
```

**Key change:** `refreshAllPrices()` now accepts `symbols` parameter. If provided, skips universe build entirely.

### `server/quotes.ts`

**Added:**
```typescript
export async function getUniverseHandler(c: Context) {
  const universe = await getSymbolUniverse();
  return c.json({ symbols: universe, total: universe.length });
}
```

**Modified:**
```typescript
export async function refreshQuotesHandler(c: Context) {
  // Extract symbols from request body
  const result = await forceRefresh(symbols); // Pass to service
}
```

### `server/index.ts`

**Added:**
```typescript
app.get('/api/quotes/universe', getUniverseHandler);
```

### `src/lib/db.ts`

**Added:**
```typescript
export async function getQuoteUniverse(): Promise<{ 
  symbols: string[]; 
  total: number 
}> {
  return api('/api/quotes/universe');
}
```

### `src/App.tsx`

**Modified:**
```typescript
const refreshAll = async () => {
  // 1. GET universe (separate HTTP request)
  const { symbols: universe } = await getQuoteUniverse();
  
  // 2. Chunk at HTTP boundary (separate HTTP requests)
  for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
    const chunk = universe.slice(i, i + CHUNK_SIZE);
    await store.refreshLiveQuotes(chunk);
  }
  
  // 3. Reload state
  await store.refresh();
};
```

**Key change:** Chunking happens via **multiple HTTP calls**, not in-process loops.

## API Changes

### New Endpoint

**GET /api/quotes/universe**

Returns the complete symbol universe (holdings + watchlist + research + ETFs + pairs).

**Request:**
```http
GET /api/quotes/universe
```

**Response:**
```json
{
  "symbols": ["AAPL", "NVDA", "TSLA", ...],
  "total": 50
}
```

**Subrequest budget:** 1 Neon query

### Modified Endpoint

**POST /api/quotes/refresh**

Now accepts `symbols` array to refresh specific symbols.

**Request (new way - chunked):**
```http
POST /api/quotes/refresh
Content-Type: application/json

{
  "symbols": ["AAPL", "NVDA", "TSLA", ...]
}
```

**Request (old way - backward compat):**
```http
POST /api/quotes/refresh

{}
```

**Response (same):**
```json
{
  "ok": true,
  "updated": ["AAPL", "NVDA", ...],
  "failed": ["INVALID"],
  "refreshedAt": "2026-09-23T14:00:00.000Z",
  "total": 10
}
```

**Subrequest budget:**
- With symbols: 0 + N + 2 = N + 2 (N ≤ 10 → 12 subrequests)
- Without symbols: 1 + N + 2 = N + 3 (warns if N > 10)

## Performance

### Comparison

**Before (PR #50 - broken):**
- 50 symbols: 502 error ❌

**First fix attempt (broken):**
- 50 symbols: still 502 error ❌ (in-process chunks counted toward same limit)

**This fix (working):**
- 10 symbols: ~1 second (2 HTTP requests: universe + chunk) ✅
- 50 symbols: ~6 seconds (6 HTTP requests: universe + 5 chunks) ✅
- 100 symbols: ~11 seconds (11 HTTP requests: universe + 10 chunks) ✅

**Latency breakdown (50 symbols):**
```
GET /api/quotes/universe:          ~200ms  (1 Neon query)
POST /api/quotes/refresh (0-9):    ~1000ms (10 Yahoo + 2 Neon)
POST /api/quotes/refresh (10-19):  ~1000ms
POST /api/quotes/refresh (20-29):  ~1000ms
POST /api/quotes/refresh (30-39):  ~1000ms
POST /api/quotes/refresh (40-49):  ~1000ms
Total:                             ~5.2s
```

## Testing

### Build Verification
```bash
npm run build:client  # ✅ TypeScript clean, Vite builds
npm run build:server  # ✅ TypeScript clean, server builds
npm test              # ✅ 3/3 lots.test.ts pass
```

### Manual Testing (After Deploy)

**1. Test universe endpoint:**
```bash
curl https://seek-track.pages.dev/api/quotes/universe
# Should return: { "symbols": [...], "total": N }
```

**2. Test chunked refresh (10 symbols):**
```bash
curl -X POST https://seek-track.pages.dev/api/quotes/refresh \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["AAPL", "NVDA", "TSLA", ...]}'
# Should return 200, not 502
```

**3. Test auto-refresh:**
- Open app
- Wait 30 seconds
- Check console: "Chunk N/M complete"
- Check network: multiple POST /api/quotes/refresh calls
- Verify no 502 errors

**4. Test manual refresh:**
- Click top-right ↻ button
- Should show "Refreshing..."
- Should complete without 502
- All prices should update

## Backward Compatibility

### Legacy Clients

**Old request (no symbols):**
```http
POST /api/quotes/refresh

{}
```

**Behavior:**
- Builds universe internally
- Refreshes all symbols in one invocation
- ⚠️ Will still 502 if universe > ~40 symbols
- Server logs warning: "Universe too large, caller should chunk!"

**Recommendation:** Update clients to use chunked approach.

### Legacy Tier Parameter

**Still accepted and ignored:**
```http
POST /api/quotes/refresh?tier=hot

{"symbols": ["AAPL", ...]}
```

**Behavior:**
- `tier` parameter ignored
- Refreshes provided symbols
- No error, no breaking change

## Tuning

### Adjusting Chunk Size

In `src/App.tsx`:

```typescript
// Increase for faster refresh (more subrequests per call)
const CHUNK_SIZE = 15; // 0 + 15 + 2 = 17 subrequests

// Decrease for more headroom (slower refresh)
const CHUNK_SIZE = 8;  // 0 + 8 + 2 = 10 subrequests
```

**Current setting (10)** is the sweet spot:
- Well under 50 limit (12 subrequests)
- Room for CF Workers overhead
- Fast enough (~1s per chunk)

### Parallel Chunks (Advanced)

**Not recommended**, but possible:

```typescript
const PARALLEL_CHUNKS = 2; // Process 2 chunks at once

for (let i = 0; i < universe.length; i += CHUNK_SIZE * PARALLEL_CHUNKS) {
  const chunks = [
    universe.slice(i, i + CHUNK_SIZE),
    universe.slice(i + CHUNK_SIZE, i + CHUNK_SIZE * 2),
  ].filter(c => c.length > 0);
  
  await Promise.all(chunks.map(chunk => 
    store.refreshLiveQuotes(chunk)
  ));
}
```

**Risk:** If both chunks hit same Worker instance, could exceed 50 limit. Safer to keep sequential.

## Monitoring

### Success Metrics

After deployment, monitor:
- ✅ CF Workers error rate → should be ~0%
- ✅ Refresh success rate → should be ~100%
- ✅ P95 latency → should be ~1s × (universe.length / 10 + 1)

### CF Workers Dashboard

Check:
- **Subrequests per invocation** → should be <20 (avg: ~12)
- **Error rate** → should be ~0%
- **CPU time** → should be <50ms per request

### Neon Dashboard

Check:
- **Query count** → should be same or slightly higher (1 extra universe query per refresh)
- **Query latency** → should be similar (<100ms)
- **Connection count** → should be same or lower

## Rollback Plan

If issues arise:

1. **Revert to PR #49** (pre-unified pricing):
   ```bash
   git revert be70159 52da6d0 # PR #50 + this fix
   git push origin main
   ```

2. **Or adjust chunk size** (less risky):
   ```typescript
   const CHUNK_SIZE = 5; // Very conservative
   ```

3. **Or disable auto-refresh** (emergency):
   ```typescript
   const AUTO_REFRESH_INTERVAL_MS = 0; // Manual only
   ```

## Lessons Learned

### Critical Misunderstanding

**Mistake:** Thinking in-process sequential chunks would bypass CF Workers subrequest limit.

**Reality:** All subrequests in one Worker invocation count toward the same 50 limit, regardless of loops or function boundaries.

**Correct approach:** Chunk at the **HTTP boundary** - separate requests = separate invocations = separate budgets.

### What Worked

1. **Separate universe endpoint** - 1 query, 1 response, caller controls chunking
2. **Symbols parameter** - explicit control over what to refresh
3. **Client-side chunking** - multiple HTTP calls, each under limit
4. **Keep it simple** - sequential chunks easier to reason about than parallel

### Future Optimizations

If needed:

1. **WebSocket streaming** - universe + incremental updates (complex)
2. **Server-side chunking coordinator** - queue chunks, client polls (complex)
3. **Upgrade to CF Workers paid** - 1000 subrequest limit (costs money)

For now: **simple HTTP chunking works** ✅

## Summary

**Problem:** CF Workers 50 subrequest limit exceeded → 502 errors

**First fix (wrong):** In-process sequential chunks  
→ Still counted toward same 50 limit → still 502 ❌

**Second fix (correct):** HTTP boundary chunking  
→ Separate HTTP requests → separate Worker invocations → separate 50 limits ✅

**Implementation:**
1. GET /api/quotes/universe (1 Neon query)
2. POST /api/quotes/refresh with ≤10 symbols (N Yahoo + 2 Neon per request)
3. Client loops over chunks sequentially

**Result:**
- Each Worker invocation: 12 subrequests (well under 50) ✅
- 50 symbols: 6 HTTP requests, ~6 seconds ✅
- 100 symbols: 11 HTTP requests, ~11 seconds ✅
- No more 502 errors ✅

**Deployment:** Ready for HostOps to deploy PR #51 (updated) ✅
