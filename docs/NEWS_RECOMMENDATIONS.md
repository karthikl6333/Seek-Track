# News Recommendations Feature

Real-time market news signals on the Seek-Track Overview page, powered by hybrid sources: X/Twitter (free tier), Finnhub (authoritative cross-check), optional RSS, and LLM parsing.

## Overview

The News Recommendations feature provides a horizontally scrollable tile on the Overview page displaying actionable trading signals extracted from financial news. Each card shows:

- **Ticker** (if applicable)
- **Direction** (bullish/bearish/neutral badge)
- **Confidence** (0-100%, scored from LLM + source weighting + corroboration)
- **One-line rationale** (from LLM)
- **Position impact** (mapped to user's portfolio symbols)
- **Corroboration status** (confirmed/unconfirmed badge)
- **Source count** (number of deduplicated sources)
- **Time ago** (minutes/hours since signal created)
- **Link** (to authoritative source when corroborated)

The tile includes:
- **Last updated timestamp** (IST timezone)
- **Manual refresh button**
- **Graceful degradation** (shows clear error if API keys missing or sources unavailable)

## Architecture

### Data Flow

1. **Fetch** from multiple sources (~5 min cadence):
   - X/Twitter (pluggable: Nitter RSS, RSSHub, or paid API)
   - Finnhub (company news + market news)
   - RSS (optional supplementary feeds)

2. **Parse** with LLM (single batch call):
   - Extract ticker, direction, confidence, rationale, position impact
   - Uses OpenAI-compatible or Anthropic API
   - Enforces JSON output schema

3. **Deduplicate** near-identical signals:
   - Normalize text (lowercase, strip punctuation)
   - Cluster by Jaccard similarity (>60% threshold)
   - Merge duplicate sources into one card

4. **Score & Corroborate**:
   - Source weighting: verified accounts, multiple sources, Finnhub presence
   - Corroboration: X signal + authoritative source (Finnhub/RSS)
   - Final confidence = LLM confidence + source weight

5. **Cache** in Neon Postgres:
   - Table: `news_recommendations` (24-hour retention)
   - Refresh lock prevents concurrent stampede

6. **Serve** via GET endpoint:
   - Returns cached signals sorted by confidence
   - Refresh endpoint checks staleness (5-min threshold)

### Subrequest Budget (Cloudflare Workers)

Per refresh call (worst case):
- **X source**: 2-3 requests (Nitter instances fallback or RSSHub lists)
- **Finnhub**: 1 market + 3 company news = 4 requests
- **RSS**: 2 feeds (optional)
- **LLM**: 1 batch call
- **Neon DB**: 3-5 queries (universe, save, lock)

**Total**: ~15-20 subrequests per refresh (well under 50 limit ✅)

## X/Twitter Source Options

### Cost & Trade-offs Comparison

| Method | Monthly Cost | Latency | Coverage | Fragility | ToS Risk | Notes |
|--------|--------------|---------|----------|-----------|----------|-------|
| **Nitter RSS** (default) | **$0** | 1-5 min | Limited (configured accounts) | High (instances unreliable) | Medium | Public Nitter instances go down frequently; requires fallback to multiple instances |
| **RSSHub** (public) | **$0** | 2-10 min | Medium (X lists) | Medium | Low | More stable than Nitter, but rate-limited on public instance |
| **RSSHub** (self-hosted) | **$5-15/mo** | 2-10 min | Medium (X lists) | Low | Low | Deploy on cheap VPS (DigitalOcean, Hetzner); full control |
| **X API Free Tier** | **$0** | N/A | None | N/A | N/A | No useful endpoints (read access requires paid tier) |
| **X API Basic** (future) | **~$200/mo** | <1 min | Full search | Low | None | Official API; search endpoint for real-time ticker mentions |

### Current Implementation: Nitter RSS (Pluggable)

**Default mode**: `X_SOURCE_MODE=nitter`

The implementation tries multiple Nitter instances in sequence for each configured account:
1. `nitter.poast.org`
2. `nitter.privacydev.net`
3. `nitter.net`

If the first instance fails, it automatically falls back to the next. This mitigates the high fragility of individual Nitter instances.

**Limitations**:
- Only fetches from accounts you explicitly configure (`X_ACCOUNTS`)
- Limited to ~3 accounts per refresh (subrequest budget)
- No full search across all tweets (unlike paid API)
- Latency depends on Nitter instance cache freshness (1-5 min typical)

**When to upgrade to paid X API**:
- Need real-time signals (<1 min latency)
- Want full search across all finance tweets (not just specific accounts)
- Require higher reliability (Nitter instances are community-run and unstable)

## Configuration

### Required Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `FINNHUB_API_KEY` | **Yes** | Finnhub API key (free tier available) | `abc123...` |
| `XAI_API_KEY` | **Yes** | xAI API key for Grok LLM parsing | `xai-...` |

### Optional Environment Variables

| Variable | Default | Description | Example |
|----------|---------|-------------|---------|
| `X_SOURCE_MODE` | `nitter` | X source type: `nitter`, `rsshub`, or `x-api` | `nitter` |
| `X_ACCOUNTS` | (empty) | Comma-separated X accounts for Nitter RSS | `DeItaone,Fxhedgers,zerohedge` |
| `X_LIST_IDS` | (empty) | Comma-separated X list IDs for RSSHub | `123456,789012` |
| `X_BEARER_TOKEN` | (empty) | X API bearer token (for paid API mode) | `AAAA...` |
| `RSSHUB_URL` | `https://rsshub.app` | RSSHub instance URL (public or self-hosted) | `https://my-rsshub.com` |
| `RSS_FEEDS` | (empty) | Comma-separated RSS feed URLs (supplementary) | `https://feeds.reuters.com/reuters/businessNews` |
| `LLM_PROVIDER` | `openai` | LLM provider wire format: `openai` (includes xAI) or `anthropic` | `openai` |
| `LLM_MODEL` | `grok-4.3` | LLM model name | `grok-4.3` |
| `LLM_API_KEY` | (empty) | Alternative LLM API key (fallback if XAI_API_KEY not set) | `sk-...` |
| `OPENAI_API_KEY` | (empty) | OpenAI API key (fallback if XAI_API_KEY and LLM_API_KEY not set) | `sk-...` |
| `OPENAI_API_BASE` | `https://api.x.ai/v1/chat/completions` | OpenAI-compatible API endpoint (override for OpenAI or other providers) | `https://api.openai.com/v1/chat/completions` |

### Getting API Keys

#### Finnhub (Required, Free Tier Available)

1. Sign up at https://finnhub.io
2. Free tier includes:
   - 60 API calls/min
   - Company news and market news endpoints
3. Copy your API key from the dashboard
4. Set `FINNHUB_API_KEY` in Cloudflare environment variables

**Cost**: Free tier sufficient for this use case

#### xAI Grok (Required for LLM Parsing, Default)

1. Sign up at https://x.ai or https://console.x.ai
2. Create an API key
3. Fund your account (pay-as-you-go)
4. Set `XAI_API_KEY` in Cloudflare environment variables

**Cost**: ~$1-5/day with `grok-4.3` (1 batch call per refresh, ~5 min cadence)

**Model**: `grok-4.3` (default, stable alias) - Fast, cheap, suitable for JSON batch parsing

**Alternatives**: `grok-4.20-0309-non-reasoning` (non-reasoning variant, better latency)

**Alternative**: Use OpenAI instead by setting:
- `OPENAI_API_BASE=https://api.openai.com/v1/chat/completions`
- `OPENAI_API_KEY=sk-...`
- `LLM_MODEL=gpt-4o-mini`

**Alternative**: Use Anthropic Claude by setting:
- `LLM_PROVIDER=anthropic`
- `LLM_API_KEY=<your-anthropic-key>`
- `LLM_MODEL=claude-3-haiku-20240307`

#### X/Twitter (Optional, Free Tier Limitations)

**Free Option (Nitter RSS)**: No API key needed
1. Choose finance-focused X accounts to follow (e.g., `DeItaone`, `Fxhedgers`, `zerohedge`)
2. Set `X_ACCOUNTS=DeItaone,Fxhedgers,zerohedge`
3. Optionally set `X_SOURCE_MODE=nitter` (default)

**Paid Option (X API Basic)**: $200/month
1. Sign up for X API at https://developer.twitter.com
2. Subscribe to Basic tier ($200/mo) for search endpoint access
3. Copy bearer token from developer portal
4. Set `X_BEARER_TOKEN` and `X_SOURCE_MODE=x-api`

**RSSHub Option (Free or Self-Hosted)**:
- Public instance: Set `RSSHUB_URL=https://rsshub.app` and `X_LIST_IDS=...` (X list IDs)
- Self-hosted: Deploy RSSHub on a VPS ($5-15/mo), set `RSSHUB_URL` to your instance

### Cloudflare Configuration

Add environment variables in Cloudflare Dashboard:
1. Go to **Workers & Pages** → Your project → **Settings** → **Environment Variables**
2. Add **Production** variables:
   - `FINNHUB_API_KEY`: Your Finnhub key
   - `XAI_API_KEY`: Your xAI key
   - `X_ACCOUNTS`: Comma-separated X accounts (e.g., `DeItaone,Fxhedgers`)
   - (Optional) `X_SOURCE_MODE`, `LLM_PROVIDER`, `LLM_MODEL`, `RSS_FEEDS`

Or use Wrangler CLI:
```bash
wrangler pages secret put FINNHUB_API_KEY --project-name=seek-track
wrangler pages secret put XAI_API_KEY --project-name=seek-track
wrangler pages secret put X_ACCOUNTS --project-name=seek-track
```

## API Endpoints

### GET /api/news

Returns cached news signals.

**Request:**
```http
GET /api/news
```

**Response (success):**
```json
{
  "ok": true,
  "signals": [
    {
      "id": "news_1234567890_abc123",
      "ticker": "NVDA",
      "direction": "bullish",
      "confidence": 0.85,
      "rationale": "Strong Q3 earnings beat estimates",
      "positionImpact": "NVDA direct, SOXL/SMH exposure increases",
      "corroborationStatus": "corroborated",
      "corroborationLink": "https://finnhub.io/...",
      "sourceCount": 3,
      "sourceIds": "x:DeItaone,finnhub:Reuters,rss:reuters.com",
      "normalizedText": "nvidia nvda strong q3 earnings beat estimates...",
      "originalTexts": ["NVDA: Strong Q3 earnings...", "Nvidia beats..."],
      "createdAt": "2026-09-24T04:30:00.000Z",
      "refreshedAt": "2026-09-24T04:35:00.000Z"
    }
  ],
  "refreshedAt": "2026-09-24T04:35:00.000Z"
}
```

**Response (unconfigured):**
```json
{
  "ok": true,
  "signals": [],
  "refreshedAt": null
}
```

### POST /api/news/refresh

Triggers a news refresh (respects 5-min staleness threshold and refresh lock).

**Request:**
```http
POST /api/news/refresh
```

**Response (success):**
```json
{
  "status": "ok",
  "signals": [...],
  "refreshedAt": "2026-09-24T04:35:00.000Z",
  "stats": {
    "xSignals": 5,
    "finnhubSignals": 8,
    "rssSignals": 2,
    "llmCalls": 1,
    "duplicatesRemoved": 3
  }
}
```

**Response (unconfigured):**
```json
{
  "status": "unconfigured",
  "missing": ["FINNHUB_API_KEY", "XAI_API_KEY (or LLM_API_KEY)"],
  "error": "Missing required env vars: FINNHUB_API_KEY, XAI_API_KEY (or LLM_API_KEY)",
  "refreshedAt": "2026-09-24T04:35:00.000Z"
}
```

**Response (partial - some sources degraded):**
```json
{
  "status": "partial",
  "signals": [...],
  "degraded": ["X/Twitter"],
  "refreshedAt": "2026-09-24T04:35:00.000Z",
  "stats": {
    "xSignals": 0,
    "finnhubSignals": 8,
    "rssSignals": 0,
    "llmCalls": 1,
    "duplicatesRemoved": 0
  }
}
```

**Response (cached - not stale yet):**
```json
{
  "status": "ok",
  "signals": [...],
  "message": "Using cached signals (refresh interval not elapsed)",
  "refreshedAt": "2026-09-24T04:30:00.000Z"
}
```

## Database Schema

### news_recommendations

```sql
CREATE TABLE IF NOT EXISTS news_recommendations (
  id TEXT PRIMARY KEY,
  ticker TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('bullish', 'bearish', 'neutral')),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  rationale TEXT NOT NULL,
  position_impact TEXT NOT NULL DEFAULT '',
  corroboration_status TEXT NOT NULL CHECK (corroboration_status IN ('corroborated', 'unconfirmed')),
  corroboration_link TEXT,
  source_count INTEGER NOT NULL DEFAULT 1,
  source_ids TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  original_texts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `news_recommendations_ticker_idx` (ticker)
- `news_recommendations_created_idx` (created_at DESC)
- `news_recommendations_refreshed_idx` (refreshed_at DESC)

**Retention**: 24 hours (old signals auto-deleted on refresh)

### news_refresh_lock

```sql
CREATE TABLE IF NOT EXISTS news_refresh_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  locked_at TIMESTAMPTZ,
  locked_by TEXT
);
```

Prevents concurrent refresh stampede when multiple users click refresh simultaneously. Lock expires after 2 minutes.

## UI Components

### NewsRecommendations.tsx

React component rendered on Overview page.

**Features:**
- Horizontal scrollable card layout
- Color-coded direction badges (green=bullish, red=bearish, gray=neutral)
- Confidence percentage bar (green ≥70%, orange ≥50%, gray <50%)
- Corroboration badge (confirmed/unconfirmed)
- Time-ago display (e.g., "5m ago", "2h ago")
- Manual refresh button
- Graceful error/unconfigured states

**Placement**: Directly below P&L tiles on Overview page (full-width tile)

## Testing on Production

After deploying to https://seek-track.pages.dev:

### 1. Check Unconfigured State

**Before setting env vars**, open Overview page:
- Should see News Recommendations tile
- Should show "News feed not configured: set FINNHUB_API_KEY, LLM_API_KEY"
- Page should not break

### 2. Configure API Keys

Add required env vars in Cloudflare Dashboard:
- `FINNHUB_API_KEY`
- `OPENAI_API_KEY`
- `X_ACCOUNTS` (optional, e.g., `DeItaone,Fxhedgers`)

Redeploy or wait for env var propagation.

### 3. Test Refresh Endpoint

```bash
# Should return unconfigured status (if keys not set)
curl https://seek-track.pages.dev/api/news/refresh \
  -X POST \
  -H "Authorization: Basic $(echo -n 'admin:YOUR_PASSWORD' | base64)"

# Expected: {"status":"unconfigured", "missing":[...]}
```

After setting keys:
```bash
# Should fetch and parse news
curl https://seek-track.pages.dev/api/news/refresh \
  -X POST \
  -H "Authorization: Basic $(echo -n 'admin:YOUR_PASSWORD' | base64)"

# Expected: {"status":"ok", "signals":[...], "stats":{...}}
```

### 4. Verify UI

1. Open https://seek-track.pages.dev (log in with Basic Auth)
2. Go to Overview page
3. Scroll down to News Recommendations tile
4. Should see horizontal scrollable cards (if signals exist)
5. Click "Refresh" button
6. Should see loading state, then updated signals
7. Hover over cards to see link highlight
8. Click "Source →" link to verify Finnhub article opens

### 5. Check Subrequest Budget

Monitor Cloudflare Workers logs in Dashboard → Functions → Logs:
- Each refresh should complete without 502 errors
- Should see ~15-20 subrequests logged per refresh
- No "Too many subrequests" errors

### 6. Test Degraded State

Temporarily remove `X_ACCOUNTS` or set invalid Nitter accounts:
- Refresh should still succeed with Finnhub-only signals
- UI should show "Partial: X/Twitter unavailable" warning
- Page should not break

## Monitoring

### Success Metrics

- ✅ No 502 errors on `/api/news/refresh`
- ✅ Subrequest count ≤20 per refresh
- ✅ News tile renders without breaking Overview page
- ✅ Graceful degradation when API keys missing
- ✅ Signals refresh every ~5 min (check `refreshedAt` timestamp)

### Error Cases to Monitor

| Error | Cause | User Impact | Fix |
|-------|-------|-------------|-----|
| "News feed not configured" | Missing `FINNHUB_API_KEY` or `LLM_API_KEY` | Tile shows clear error message | Add env vars |
| "Partial: X/Twitter" | Nitter instances down or no `X_ACCOUNTS` set | Only Finnhub signals shown | Wait for Nitter recovery or set accounts |
| "Partial: Finnhub" | Finnhub API rate limit or outage | Only X signals shown (unconfirmed) | Wait for Finnhub recovery |
| Empty tile | No signals matched watchlist/sector terms | User sees "No news signals" message | Normal behavior |
| 500 error on refresh | LLM API error or DB connection failure | Tile shows error badge | Check LLM API status and DB connection |

### Cloudflare Logs

Check real-time logs in Dashboard → Pages → Functions → Logs:
```
POST /api/news/refresh
  └─ X signals: 5
  └─ Finnhub signals: 8
  └─ LLM calls: 1
  └─ Duplicates removed: 3
  └─ Total subrequests: 17
  └─ Status: ok
```

## Cost Estimate

### Monthly Operating Costs (Free Tier X Source)

| Service | Tier | Monthly Cost | Usage |
|---------|------|--------------|-------|
| Finnhub | Free | **$0** | 60 calls/min (enough for ~5 min refresh) |
| OpenAI (gpt-4o-mini) | Pay-as-you-go | **~$15-60** | 1 batch call per 5 min (~8,640 calls/month, ~200k tokens/month) |
| X/Twitter (Nitter RSS) | Free | **$0** | Public Nitter instances (no auth) |
| Cloudflare Workers | Free | **$0** | <100k requests/day (included) |
| Neon Postgres | Free | **$0** | Existing database |

**Total: ~$15-60/month** (LLM costs only)

### Monthly Operating Costs (Paid X API)

Replace Nitter with X API Basic:

| Service | Monthly Cost |
|---------|--------------|
| X API Basic | **$200** |
| OpenAI (gpt-4o-mini) | **~$15-60** |
| Other services | **$0** (free tiers) |

**Total: ~$215-260/month**

### Cost Optimization

To reduce LLM costs:
1. Increase refresh interval (e.g., 10 min instead of 5 min) → halve costs
2. Use cheaper model (e.g., `gpt-3.5-turbo` instead of `gpt-4o-mini`) → 50% cost reduction
3. Filter signals before LLM parsing (e.g., keyword pre-filter) → reduce tokens
4. Batch more aggressively (already optimized: 1 call per refresh)

**Recommended**: Start with free tier (Nitter + Finnhub + xAI Grok) for ~$5-20/mo, then upgrade to paid X API only if latency/coverage is insufficient.

## Troubleshooting

### Issue: Tile shows "News feed not configured"

**Cause**: Missing required env vars

**Fix**:
1. Check Cloudflare Dashboard → Settings → Environment Variables
2. Ensure `FINNHUB_API_KEY` and `XAI_API_KEY` are set
3. Redeploy or wait for propagation (may take 1-2 min)

### Issue: No signals appearing

**Cause**: Watchlist/sector terms not matched, or sources failing

**Fix**:
1. Click "Refresh" button manually
2. Check browser console for errors
3. Verify API keys are valid (test Finnhub API directly)
4. Check Cloudflare logs for error details

### Issue: "Partial: X/Twitter" warning

**Cause**: Nitter instances down or no `X_ACCOUNTS` configured

**Fix**:
- **Temporary**: Normal behavior (Nitter instances go down frequently), signals still work with Finnhub
- **Permanent**: Set `X_ACCOUNTS` env var with finance-focused accounts (e.g., `DeItaone,Fxhedgers`)
- **Upgrade**: Consider paid X API ($200/mo) for higher reliability

### Issue: LLM parsing failures

**Cause**: xAI API rate limit, invalid key, or model downtime

**Fix**:
1. Check xAI API status: https://status.x.ai (if available)
2. Verify API key has sufficient credits
3. Try alternative provider: 
   - OpenAI: Set `OPENAI_API_BASE=https://api.openai.com/v1/chat/completions`, `OPENAI_API_KEY`, `LLM_MODEL=gpt-4o-mini`
   - Anthropic: Set `LLM_PROVIDER=anthropic`, `LLM_API_KEY` (Anthropic key), `LLM_MODEL=claude-3-haiku-20240307`

### Issue: Refresh button stuck on "Refreshing..."

**Cause**: Refresh lock held (concurrent refresh) or network timeout

**Fix**:
- Wait 2 min (lock expires automatically)
- Refresh page
- Check Cloudflare logs for errors

## Future Enhancements

### Cron Trigger (Optional)

Enable automatic background refresh without manual clicks:

1. Go to Cloudflare Dashboard → Pages → Settings → Triggers
2. Add Cron Trigger:
   - **Schedule**: `*/5 * * * *` (every 5 minutes)
   - **Route**: `/api/news/refresh`
3. Save

**Note**: Cron Triggers are optional. The current implementation refreshes on-demand (user clicks or auto-refresh when stale).

### Additional Features

- **Watchlist integration**: Auto-fetch tickers from user's open positions (already implemented via `WATCHLIST_SYMBOLS`)
- **Sentiment trend**: Track sentiment changes over time (e.g., "bullish increasing")
- **Alert thresholds**: Notify user when high-confidence signals appear (requires push notifications)
- **Historical archive**: Keep signals beyond 24 hours for backtesting

## Summary

The News Recommendations feature provides real-time market signals on the Overview page with:

✅ **Hybrid sources**: X/Twitter (free tier), Finnhub, RSS  
✅ **LLM parsing**: xAI Grok (default) extracts ticker, direction, confidence, rationale  
✅ **Deduplication**: Clusters near-identical signals  
✅ **Corroboration**: Cross-checks X against authoritative sources  
✅ **Graceful degradation**: Clear errors when API keys missing  
✅ **Subrequest budget**: ~15-20 per refresh (well under 50 limit)  
✅ **Cost-effective**: ~$5-20/mo with free X source, ~$205-220/mo with paid X API  

**Recommended setup**: Start with Nitter RSS (free) + Finnhub + xAI Grok (grok-4.3), then upgrade to paid X API only if you need <1 min latency or broader coverage.

**Alternative LLM providers**: OpenAI (set `OPENAI_API_BASE` + `OPENAI_API_KEY`) or Anthropic (set `LLM_PROVIDER=anthropic` + `LLM_API_KEY`) work as drop-in replacements.
