import { query } from './db.js';

// ============================================================================
// TYPES
// ============================================================================

export interface NewsSignal {
  id: string;
  ticker: string | null;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number; // 0-1
  rationale: string;
  positionImpact: string;
  corroborationStatus: 'corroborated' | 'unconfirmed';
  corroborationLink: string | null;
  sourceCount: number;
  sourceIds: string;
  normalizedText: string;
  originalTexts: string[];
  createdAt: string;
  refreshedAt: string;
}

export interface RawSignal {
  text: string;
  sourceId: string;
  sourceType: 'x' | 'finnhub' | 'rss';
  timestamp: string;
  link?: string;
  verified?: boolean;
  followerCount?: number;
}

export interface ParsedSignal {
  ticker: string | null;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  rationale: string;
  positionImpact: string;
}

export interface NewsRefreshResult {
  status: 'ok' | 'unconfigured' | 'partial' | 'error';
  signals?: NewsSignal[];
  missing?: string[];
  degraded?: string[];
  error?: string;
  refreshedAt: string;
  stats?: {
    xSignals: number;
    finnhubSignals: number;
    rssSignals: number;
    llmCalls: number;
    duplicatesRemoved: number;
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const LOCK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

const WATCHLIST_SYMBOLS = [
  'SOXL', 'SMH', 'AVL', 'AVGO', 'MU', 'NVDA', 'AMD', 'TSM',
  'PLTR', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA',
];

const SECTOR_TERMS = [
  'semiconductors', 'semis', 'chips', 'tariffs', 'Fed', 'FOMC',
  'earnings', 'CPI', 'jobs report', 'inflation', 'interest rates',
  'AI', 'tech', 'selloff', 'rally',
];

// ============================================================================
// X/TWITTER SOURCE (PLUGGABLE)
// ============================================================================

/**
 * Pluggable X/Twitter source interface.
 * 
 * Implementation priority (by cost):
 * 1. X API Free Tier (if any search/list access)
 * 2. Nitter RSS via public instances (e.g. nitter.net/user/rss)
 * 3. RSSHub for X lists/accounts (self-hostable or public instance)
 * 4. Paid X API as fallback (env: X_BEARER_TOKEN)
 * 
 * Current implementation: Nitter RSS + X API Free Tier fallback
 */
async function fetchXSignals(): Promise<RawSignal[]> {
  const xMode = process.env.X_SOURCE_MODE || 'nitter'; // 'nitter' | 'rsshub' | 'x-api'
  
  try {
    switch (xMode) {
      case 'nitter':
        return await fetchNitterRSS();
      case 'rsshub':
        return await fetchRSSHub();
      case 'x-api':
        return await fetchXAPI();
      default:
        console.warn(`Unknown X_SOURCE_MODE: ${xMode}, falling back to Nitter`);
        return await fetchNitterRSS();
    }
  } catch (err) {
    console.error(`X source (${xMode}) failed:`, err);
    return [];
  }
}

/**
 * Nitter RSS: Free, no auth, public instances available.
 * Latency: ~1-5 min (depends on instance cache)
 * Cost: $0/month
 * Fragility: High (public instances go down frequently)
 * Coverage: Limited to specific accounts we configure
 */
async function fetchNitterRSS(): Promise<RawSignal[]> {
  const accounts = (process.env.X_ACCOUNTS || '').split(',').filter(Boolean);
  if (accounts.length === 0) {
    console.log('No X_ACCOUNTS configured for Nitter RSS');
    return [];
  }

  // Try multiple Nitter instances (they go down frequently)
  const nitterInstances = [
    'nitter.poast.org',
    'nitter.privacydev.net',
    'nitter.net',
  ];

  const signals: RawSignal[] = [];
  
  for (const account of accounts.slice(0, 3)) { // Limit to 3 accounts to stay under subrequest budget
    for (const instance of nitterInstances) {
      try {
        const url = `https://${instance}/${account}/rss`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'SeekTrack/1.0' },
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) continue;

        const xml = await response.text();
        const tweets = parseNitterRSS(xml);
        signals.push(...tweets.map(t => ({
          text: t.text,
          sourceId: `x:${account}`,
          sourceType: 'x' as const,
          timestamp: t.timestamp,
          link: t.link,
          verified: true, // Configured accounts are trusted
        })));
        
        break; // Success, no need to try other instances for this account
      } catch (err) {
        console.warn(`Nitter instance ${instance} failed for ${account}:`, err);
        continue;
      }
    }
  }

  return signals;
}

function parseNitterRSS(xml: string): Array<{ text: string; timestamp: string; link?: string }> {
  const items: Array<{ text: string; timestamp: string; link?: string }> = [];
  
  // Simple regex parsing (RSS is predictable enough for this)
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    
    const descMatch = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(itemXml);
    const pubDateMatch = /<pubDate>(.*?)<\/pubDate>/.exec(itemXml);
    const linkMatch = /<link>(.*?)<\/link>/.exec(itemXml);
    
    if (descMatch && pubDateMatch) {
      // Strip HTML tags from description
      const text = descMatch[1].replace(/<[^>]*>/g, '').trim();
      items.push({
        text,
        timestamp: new Date(pubDateMatch[1]).toISOString(),
        link: linkMatch?.[1],
      });
    }
  }
  
  return items;
}

/**
 * RSSHub: Self-hostable or public instance, supports X lists.
 * Latency: ~2-10 min
 * Cost: $0/month (public) or ~$5-15/month (self-hosted VPS)
 * Fragility: Medium (more reliable than Nitter, but still rate-limited)
 */
async function fetchRSSHub(): Promise<RawSignal[]> {
  const rsshubUrl = process.env.RSSHUB_URL || 'https://rsshub.app';
  const listIds = (process.env.X_LIST_IDS || '').split(',').filter(Boolean);
  
  if (listIds.length === 0) {
    console.log('No X_LIST_IDS configured for RSSHub');
    return [];
  }

  const signals: RawSignal[] = [];
  
  for (const listId of listIds.slice(0, 2)) { // Limit to 2 lists
    try {
      const url = `${rsshubUrl}/twitter/list/${listId}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'SeekTrack/1.0' },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) continue;

      const xml = await response.text();
      const tweets = parseNitterRSS(xml); // Same RSS format
      signals.push(...tweets.map(t => ({
        text: t.text,
        sourceId: `x:list:${listId}`,
        sourceType: 'x' as const,
        timestamp: t.timestamp,
        link: t.link,
      })));
    } catch (err) {
      console.warn(`RSSHub list ${listId} failed:`, err);
      continue;
    }
  }

  return signals;
}

/**
 * X API (paid): Official API with bearer token.
 * Latency: <1 min (real-time)
 * Cost: ~$200/month (Basic tier for search)
 * Fragility: Low (official API)
 * Coverage: Full search across all tweets
 */
async function fetchXAPI(): Promise<RawSignal[]> {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    console.log('X_BEARER_TOKEN not configured');
    return [];
  }

  const signals: RawSignal[] = [];
  
  // Search for recent tweets mentioning key tickers
  const searchQuery = WATCHLIST_SYMBOLS.slice(0, 5).map(s => `$${s}`).join(' OR ');
  
  try {
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(searchQuery)}&max_results=20&tweet.fields=created_at,author_id,public_metrics`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'User-Agent': 'SeekTrack/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      console.error('X API error:', response.status, error);
      return [];
    }

    const data = await response.json() as {
      data?: Array<{
        id: string;
        text: string;
        created_at: string;
        author_id: string;
        public_metrics?: { followers_count?: number };
      }>;
    };

    if (data.data) {
      for (const tweet of data.data) {
        signals.push({
          text: tweet.text,
          sourceId: `x:${tweet.author_id}`,
          sourceType: 'x',
          timestamp: tweet.created_at,
          link: `https://twitter.com/i/web/status/${tweet.id}`,
          followerCount: tweet.public_metrics?.followers_count,
        });
      }
    }
  } catch (err) {
    console.error('X API search failed:', err);
  }

  return signals;
}

// ============================================================================
// FINNHUB (AUTHORITATIVE SOURCE)
// ============================================================================

async function fetchFinnhubNews(): Promise<RawSignal[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.log('FINNHUB_API_KEY not configured');
    return [];
  }

  const signals: RawSignal[] = [];
  
  try {
    // Market news (general)
    const marketUrl = `https://finnhub.io/api/v1/news?category=general&token=${apiKey}`;
    const marketRes = await fetch(marketUrl, {
      signal: AbortSignal.timeout(8000),
    });

    if (marketRes.ok) {
      const marketNews = await marketRes.json() as Array<{
        headline: string;
        summary: string;
        datetime: number;
        url: string;
        source: string;
      }>;

      for (const item of marketNews.slice(0, 10)) {
        signals.push({
          text: `${item.headline}. ${item.summary}`,
          sourceId: `finnhub:${item.source}`,
          sourceType: 'finnhub',
          timestamp: new Date(item.datetime * 1000).toISOString(),
          link: item.url,
          verified: true,
        });
      }
    }

    // Company news for top tickers (limit to 3 to stay under budget)
    for (const symbol of WATCHLIST_SYMBOLS.slice(0, 3)) {
      try {
        const companyUrl = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${getDateDaysAgo(1)}&to=${getDateDaysAgo(0)}&token=${apiKey}`;
        const companyRes = await fetch(companyUrl, {
          signal: AbortSignal.timeout(8000),
        });

        if (companyRes.ok) {
          const companyNews = await companyRes.json() as Array<{
            headline: string;
            summary: string;
            datetime: number;
            url: string;
            source: string;
          }>;

          for (const item of companyNews.slice(0, 5)) {
            signals.push({
              text: `${symbol}: ${item.headline}. ${item.summary}`,
              sourceId: `finnhub:${item.source}`,
              sourceType: 'finnhub',
              timestamp: new Date(item.datetime * 1000).toISOString(),
              link: item.url,
              verified: true,
            });
          }
        }
      } catch (err) {
        console.warn(`Finnhub company news for ${symbol} failed:`, err);
        continue;
      }
    }
  } catch (err) {
    console.error('Finnhub news fetch failed:', err);
  }

  return signals;
}

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

// ============================================================================
// RSS (OPTIONAL SUPPLEMENTARY)
// ============================================================================

async function fetchRSSFeeds(): Promise<RawSignal[]> {
  const rssUrls = (process.env.RSS_FEEDS || '').split(',').filter(Boolean);
  if (rssUrls.length === 0) {
    return [];
  }

  const signals: RawSignal[] = [];

  for (const url of rssUrls.slice(0, 2)) { // Limit to 2 feeds
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'SeekTrack/1.0' },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) continue;

      const xml = await response.text();
      const items = parseGenericRSS(xml);
      
      signals.push(...items.map(item => ({
        text: item.text,
        sourceId: `rss:${new URL(url).hostname}`,
        sourceType: 'rss' as const,
        timestamp: item.timestamp,
        link: item.link,
      })));
    } catch (err) {
      console.warn(`RSS feed ${url} failed:`, err);
      continue;
    }
  }

  return signals;
}

function parseGenericRSS(xml: string): Array<{ text: string; timestamp: string; link?: string }> {
  const items: Array<{ text: string; timestamp: string; link?: string }> = [];
  
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    
    const titleMatch = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>(.*?)<\/title>/.exec(itemXml);
    const descMatch = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>(.*?)<\/description>/.exec(itemXml);
    const pubDateMatch = /<pubDate>(.*?)<\/pubDate>/.exec(itemXml);
    const linkMatch = /<link>(.*?)<\/link>/.exec(itemXml);
    
    const title = titleMatch?.[1] || titleMatch?.[2] || '';
    const desc = descMatch?.[1] || descMatch?.[2] || '';
    const text = `${title}. ${desc}`.replace(/<[^>]*>/g, '').trim();
    
    if (text && pubDateMatch) {
      items.push({
        text,
        timestamp: new Date(pubDateMatch[1]).toISOString(),
        link: linkMatch?.[1],
      });
    }
  }
  
  return items;
}

// ============================================================================
// LLM PARSING
// ============================================================================

/**
 * Parse raw signals using LLM to extract structured data.
 * 
 * Default provider: xAI Grok (OpenAI-compatible API)
 * - Default model: grok-4.3 (stable alias, fast, cheap, suitable for JSON parsing)
 * - Default base URL: https://api.x.ai/v1
 * 
 * Alternative providers:
 * - OpenAI: Set OPENAI_API_BASE + OPENAI_API_KEY + LLM_MODEL
 * - Anthropic: Set LLM_PROVIDER=anthropic + LLM_API_KEY
 */
async function parseBatchWithLLM(signals: RawSignal[]): Promise<Map<RawSignal, ParsedSignal>> {
  const provider = process.env.LLM_PROVIDER || 'openai'; // 'openai' wire format (includes xAI) | 'anthropic'
  
  // Model selection: default to xAI Grok
  const model = process.env.LLM_MODEL || 'grok-4.3';
  
  // API key fallback chain: XAI_API_KEY -> LLM_API_KEY -> OPENAI_API_KEY
  const apiKey = process.env.XAI_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('LLM API key not configured (set XAI_API_KEY or LLM_API_KEY), skipping parsing');
    return new Map();
  }

  const results = new Map<RawSignal, ParsedSignal>();
  
  // Batch process (all signals in one LLM call to minimize subrequests)
  const prompt = buildLLMPrompt(signals);
  
  try {
    let parsed: ParsedSignal[];
    
    if (provider === 'anthropic') {
      parsed = await callAnthropicAPI(apiKey, model, prompt);
    } else {
      // 'openai' provider includes xAI (OpenAI-compatible wire format)
      parsed = await callOpenAIAPI(apiKey, model, prompt);
    }

    // Map results back to signals
    for (let i = 0; i < Math.min(signals.length, parsed.length); i++) {
      results.set(signals[i], parsed[i]);
    }
  } catch (err) {
    console.error('LLM parsing failed:', err);
  }

  return results;
}

function buildLLMPrompt(signals: RawSignal[]): string {
  const userSymbols = WATCHLIST_SYMBOLS.join(', ');
  
  return `You are a financial news analyst. Parse these ${signals.length} news items and extract trading signals.

For each item, return a JSON object with:
- ticker: the primary stock ticker mentioned (or null if general market news)
- direction: "bullish", "bearish", or "neutral"
- confidence: float 0-1 (how confident is this signal)
- rationale: one-line explanation (max 100 chars)
- positionImpact: how this affects positions in: ${userSymbols} (max 80 chars)

User's portfolio: ${userSymbols}

News items:
${signals.map((s, i) => `[${i}] ${s.text.slice(0, 300)}`).join('\n\n')}

Return a JSON array of ${signals.length} objects, one per item in order. ONLY return the JSON array, no other text.`;
}

async function callOpenAIAPI(apiKey: string, model: string, prompt: string): Promise<ParsedSignal[]> {
  // Default to xAI endpoint; override with OPENAI_API_BASE for OpenAI or other compatible providers
  const url = process.env.OPENAI_API_BASE || 'https://api.x.ai/v1/chat/completions';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI-compatible API error: ${response.status} ${error}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content || '[]';
  return JSON.parse(content);
}

async function callAnthropicAPI(apiKey: string, model: string, prompt: string): Promise<ParsedSignal[]> {
  const url = 'https://api.anthropic.com/v1/messages';
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => 'Unknown error');
    throw new Error(`Anthropic API error: ${response.status} ${error}`);
  }

  const data = await response.json() as {
    content?: Array<{ text?: string }>;
  };

  const content = data.content?.[0]?.text || '[]';
  return JSON.parse(content);
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

/**
 * Deduplicate signals by normalized text similarity (Jaccard).
 */
function deduplicateSignals(
  signalsWithParsed: Array<{ raw: RawSignal; parsed: ParsedSignal }>
): Array<{ raw: RawSignal[]; parsed: ParsedSignal }> {
  const clusters: Array<{ raw: RawSignal[]; parsed: ParsedSignal }> = [];
  
  for (const item of signalsWithParsed) {
    const normalized = normalizeText(item.raw.text);
    
    // Find existing cluster with similar text
    let matched = false;
    for (const cluster of clusters) {
      const clusterNorm = normalizeText(cluster.raw[0].text);
      if (jaccardSimilarity(normalized, clusterNorm) > 0.6) {
        cluster.raw.push(item.raw);
        matched = true;
        break;
      }
    }
    
    if (!matched) {
      clusters.push({ raw: [item.raw], parsed: item.parsed });
    }
  }
  
  return clusters;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

// ============================================================================
// SCORING & CORROBORATION
// ============================================================================

function scoreAndCorroborate(
  clusters: Array<{ raw: RawSignal[]; parsed: ParsedSignal }>
): NewsSignal[] {
  const signals: NewsSignal[] = [];
  
  for (const cluster of clusters) {
    const { raw, parsed } = cluster;
    
    // Source weighting
    let sourceWeight = 0;
    const hasVerified = raw.some(s => s.verified);
    const hasFinnhub = raw.some(s => s.sourceType === 'finnhub');
    const sourceCount = raw.length;
    
    if (hasVerified) sourceWeight += 0.2;
    if (sourceCount > 1) sourceWeight += 0.1;
    if (sourceCount > 3) sourceWeight += 0.1;
    
    // Corroboration status
    const hasXSignal = raw.some(s => s.sourceType === 'x');
    const hasAuthoritativeSignal = hasFinnhub || raw.some(s => s.sourceType === 'rss');
    const corroborated = hasXSignal && hasAuthoritativeSignal;
    
    if (corroborated) sourceWeight += 0.2;
    
    // Final confidence
    const finalConfidence = Math.min(1, parsed.confidence + sourceWeight);
    
    // Corroboration link (prefer Finnhub)
    const finnhubSignal = raw.find(s => s.sourceType === 'finnhub' && s.link);
    const corroborationLink = corroborated ? (finnhubSignal?.link || raw.find(s => s.link)?.link || null) : null;
    
    signals.push({
      id: `news_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      ticker: parsed.ticker,
      direction: parsed.direction,
      confidence: finalConfidence,
      rationale: parsed.rationale,
      positionImpact: parsed.positionImpact,
      corroborationStatus: corroborated ? 'corroborated' : 'unconfirmed',
      corroborationLink,
      sourceCount,
      sourceIds: raw.map(s => s.sourceId).join(','),
      normalizedText: normalizeText(raw[0].text),
      originalTexts: raw.map(s => s.text),
      createdAt: raw[0].timestamp,
      refreshedAt: new Date().toISOString(),
    });
  }
  
  // Sort by confidence (descending)
  return signals.sort((a, b) => b.confidence - a.confidence);
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function saveSignals(signals: NewsSignal[]): Promise<void> {
  if (signals.length === 0) return;
  
  // Delete old signals (keep last 24 hours)
  await query(
    `DELETE FROM news_recommendations WHERE refreshed_at < NOW() - INTERVAL '24 hours'`
  );
  
  // Upsert new signals
  for (const signal of signals) {
    await query(
      `INSERT INTO news_recommendations (
        id, ticker, direction, confidence, rationale, position_impact,
        corroboration_status, corroboration_link, source_count, source_ids,
        normalized_text, original_texts, created_at, refreshed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        confidence = EXCLUDED.confidence,
        corroboration_status = EXCLUDED.corroboration_status,
        corroboration_link = EXCLUDED.corroboration_link,
        source_count = EXCLUDED.source_count,
        source_ids = EXCLUDED.source_ids,
        refreshed_at = EXCLUDED.refreshed_at`,
      [
        signal.id,
        signal.ticker,
        signal.direction,
        signal.confidence,
        signal.rationale,
        signal.positionImpact,
        signal.corroborationStatus,
        signal.corroborationLink,
        signal.sourceCount,
        signal.sourceIds,
        signal.normalizedText,
        JSON.stringify(signal.originalTexts),
        signal.createdAt,
        signal.refreshedAt,
      ]
    );
  }
}

async function loadSignals(): Promise<NewsSignal[]> {
  const result = await query<{
    id: string;
    ticker: string | null;
    direction: string;
    confidence: number;
    rationale: string;
    position_impact: string;
    corroboration_status: string;
    corroboration_link: string | null;
    source_count: number;
    source_ids: string;
    normalized_text: string;
    original_texts: string;
    created_at: string;
    refreshed_at: string;
  }>(
    `SELECT * FROM news_recommendations 
     ORDER BY confidence DESC, refreshed_at DESC 
     LIMIT 50`
  );

  return result.rows.map(row => ({
    id: row.id,
    ticker: row.ticker,
    direction: row.direction as 'bullish' | 'bearish' | 'neutral',
    confidence: row.confidence,
    rationale: row.rationale,
    positionImpact: row.position_impact,
    corroborationStatus: row.corroboration_status as 'corroborated' | 'unconfirmed',
    corroborationLink: row.corroboration_link,
    sourceCount: row.source_count,
    sourceIds: row.source_ids,
    normalizedText: row.normalized_text,
    originalTexts: JSON.parse(row.original_texts),
    createdAt: row.created_at,
    refreshedAt: row.refreshed_at,
  }));
}

// ============================================================================
// REFRESH LOCK (PREVENT STAMPEDE)
// ============================================================================

async function acquireRefreshLock(): Promise<boolean> {
  const lockId = `news_refresh_${Date.now()}`;
  
  try {
    const result = await query<{ locked_at: string | null; locked_by: string | null }>(
      `SELECT locked_at, locked_by FROM news_refresh_lock WHERE id = 1`
    );

    const lock = result.rows[0];
    
    // Check if lock is expired
    if (lock?.locked_at) {
      const lockedAt = new Date(lock.locked_at).getTime();
      if (Date.now() - lockedAt < LOCK_TIMEOUT_MS) {
        return false; // Lock is held
      }
    }

    // Acquire lock
    await query(
      `UPDATE news_refresh_lock SET locked_at = NOW(), locked_by = $1 WHERE id = 1`,
      [lockId]
    );

    return true;
  } catch (err) {
    console.error('Failed to acquire refresh lock:', err);
    return false;
  }
}

async function releaseRefreshLock(): Promise<void> {
  await query(`UPDATE news_refresh_lock SET locked_at = NULL, locked_by = NULL WHERE id = 1`);
}

async function shouldRefresh(): Promise<boolean> {
  const result = await query<{ refreshed_at: string }>(
    `SELECT MAX(refreshed_at) as refreshed_at FROM news_recommendations`
  );

  const lastRefresh = result.rows[0]?.refreshed_at;
  if (!lastRefresh) return true;

  const lastRefreshTime = new Date(lastRefresh).getTime();
  return Date.now() - lastRefreshTime > REFRESH_INTERVAL_MS;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export async function getNewsHandler(c: any) {
  try {
    const signals = await loadSignals();
    return c.json({
      ok: true,
      signals,
      refreshedAt: signals[0]?.refreshedAt || null,
    });
  } catch (err) {
    console.error('Failed to load news:', err);
    return c.json({ ok: false, error: String(err) }, 500);
  }
}

export async function refreshNewsHandler(c: any): Promise<Response> {
  // Check required env vars
  const missing: string[] = [];
  if (!process.env.FINNHUB_API_KEY) missing.push('FINNHUB_API_KEY');
  
  // Check for LLM API key with XAI_API_KEY as primary
  if (!process.env.XAI_API_KEY && !process.env.LLM_API_KEY && !process.env.OPENAI_API_KEY) {
    missing.push('XAI_API_KEY (or LLM_API_KEY)');
  }

  if (missing.length > 0) {
    return c.json({
      status: 'unconfigured',
      missing,
      error: `Missing required env vars: ${missing.join(', ')}`,
      refreshedAt: new Date().toISOString(),
    }, 200);
  }

  // Check if refresh is needed
  if (!(await shouldRefresh())) {
    const signals = await loadSignals();
    return c.json({
      status: 'ok',
      signals,
      message: 'Using cached signals (refresh interval not elapsed)',
      refreshedAt: signals[0]?.refreshedAt || new Date().toISOString(),
    });
  }

  // Acquire lock
  if (!(await acquireRefreshLock())) {
    const signals = await loadSignals();
    return c.json({
      status: 'ok',
      signals,
      message: 'Refresh already in progress',
      refreshedAt: signals[0]?.refreshedAt || new Date().toISOString(),
    });
  }

  try {
    const stats = {
      xSignals: 0,
      finnhubSignals: 0,
      rssSignals: 0,
      llmCalls: 0,
      duplicatesRemoved: 0,
    };

    const degraded: string[] = [];

    // Fetch from all sources
    const [xSignals, finnhubSignals, rssSignals] = await Promise.all([
      fetchXSignals().catch(err => {
        console.error('X source failed:', err);
        degraded.push('X/Twitter');
        return [];
      }),
      fetchFinnhubNews().catch(err => {
        console.error('Finnhub failed:', err);
        degraded.push('Finnhub');
        return [];
      }),
      fetchRSSFeeds().catch(err => {
        console.error('RSS failed:', err);
        return [];
      }),
    ]);

    stats.xSignals = xSignals.length;
    stats.finnhubSignals = finnhubSignals.length;
    stats.rssSignals = rssSignals.length;

    const allRawSignals = [...xSignals, ...finnhubSignals, ...rssSignals];

    if (allRawSignals.length === 0) {
      await releaseRefreshLock();
      return c.json({
        status: degraded.length > 0 ? 'partial' : 'error',
        error: 'No signals fetched from any source',
        degraded,
        refreshedAt: new Date().toISOString(),
        stats,
      });
    }

    // Parse with LLM
    const parsedMap = await parseBatchWithLLM(allRawSignals);
    stats.llmCalls = parsedMap.size > 0 ? 1 : 0;

    // Combine raw + parsed
    const signalsWithParsed = allRawSignals
      .map(raw => ({ raw, parsed: parsedMap.get(raw) }))
      .filter((item): item is { raw: RawSignal; parsed: ParsedSignal } => item.parsed !== undefined);

    // Deduplicate
    const clusters = deduplicateSignals(signalsWithParsed);
    stats.duplicatesRemoved = signalsWithParsed.length - clusters.length;

    // Score and corroborate
    const finalSignals = scoreAndCorroborate(clusters);

    // Save to DB
    await saveSignals(finalSignals);

    await releaseRefreshLock();

    return c.json({
      status: degraded.length > 0 ? 'partial' : 'ok',
      signals: finalSignals,
      degraded,
      refreshedAt: new Date().toISOString(),
      stats,
    });
  } catch (err) {
    await releaseRefreshLock();
    console.error('News refresh failed:', err);
    return c.json({
      status: 'error',
      error: String(err),
      refreshedAt: new Date().toISOString(),
    }, 500);
  }
}
