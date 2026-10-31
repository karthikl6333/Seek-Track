/**
 * "Top news": 5 plain general-market headlines for the sidebar block.
 *
 * - PLAIN NEWS ONLY. Headline text, link, source and time. No ratings, signals, sentiment or
 *   "what to do" copy (news recommendations were retired); advisory-style headlines are dropped.
 * - Public feeds only (no keys): Yahoo Finance search news API, CNBC top news RSS, MarketWatch top
 *   stories RSS. (Yahoo's old /news/rssindex now 404s.) All sources are fetched together and merged,
 *   so one feed being down never blanks the block.
 * - Every link goes to the ORIGINAL publisher article: Yahoo search items carry finance.yahoo.com
 *   wrapper URLs, so they are resolved to the publisher's canonical URL (the item's own
 *   canonicalUrl/clickThroughUrl when present, otherwise the article page's <link rel="canonical">).
 *   A Yahoo item that cannot be resolved is dropped rather than shown with a Yahoo link. CNBC and
 *   MarketWatch RSS links are kept as-is. Tracking params (utm_*, fbclid, ...) are stripped.
 * - Cached in isolate memory for ~15 min. NO D1 reads or writes anywhere in this module.
 */

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  /** ISO-8601 */
  publishedAt: string;
}

export interface TopNewsPayload {
  items: NewsItem[];
  /** When the headlines were fetched (ISO). */
  fetchedAt: string;
  /** True when the last refresh failed and these are the previously fetched headlines. */
  stale: boolean;
}

/** Headlines shown in the sidebar. */
export const NEWS_COUNT = 5;
export const NEWS_TTL_MS = 15 * 60_000;
/** After a total failure, don't hammer the feeds: retry no sooner than this. */
export const NEWS_FAIL_BACKOFF_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const PER_SOURCE_CAP = 12;
/** Max Yahoo wrapper pages resolved to a publisher URL per refresh (newest first). */
const MAX_RESOLVE = 10;
const RESOLVE_TIMEOUT_MS = 4_000;
const RESOLVE_MAX_BYTES = 400_000;
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const USER_AGENT = 'Mozilla/5.0 (compatible; SeekTrack/1.0; +https://github.com/karthikl6333/Seek-Track)';

export interface NewsSource {
  name: string;
  url: string;
  kind: 'rss' | 'yahoo-search';
}

export const NEWS_SOURCES: NewsSource[] = [
  {
    name: 'Yahoo Finance',
    url: 'https://query1.finance.yahoo.com/v1/finance/search?q=stock%20market&quotesCount=0&newsCount=12',
    kind: 'yahoo-search',
  },
  { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', kind: 'rss' },
  { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', kind: 'rss' },
];

// ── parsing ────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function tagText(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!m) return null;
  let v = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
  v = cdata ? cdata[1] : decodeEntities(v);
  v = v.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return v || null;
}

/** Only http(s) links are ever returned (never javascript:/data: from a hostile feed). */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const TRACKING_PARAM =
  /^(utm_[a-z0-9_]*|ftm_[a-z0-9_]*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|mkt_tok|igshid|yclid|_hsenc|_hsmi|ref_src|referring_guid|cmpid|taid|guccounter|guce_[a-z_]*|soc_src|soc_trk|ncid|ocid|smid|smtyp|tsrc|mod)$/i;

/** http(s) only, with tracking params and the fragment removed. */
export function cleanUrl(raw: string | null | undefined): string | null {
  const safe = safeUrl(raw);
  if (!safe) return null;
  const u = new URL(safe);
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.toString();
}

export function isYahooHost(raw: string): boolean {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return h === 'yahoo.com' || h.endsWith('.yahoo.com') || h === 'yahoo.net' || h.endsWith('.yahoo.net');
  } catch {
    return false;
  }
}

/** Parse an RSS 2.0 document into items. Tolerant: skips items missing a title, link or valid date. */
export function parseRss(xml: string, defaultSource: string): NewsItem[] {
  const out: NewsItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    if (/<metadata:sponsored>\s*true\s*</i.test(b)) continue;
    const title = tagText(b, 'title');
    const url = cleanUrl(tagText(b, 'link'));
    const date = tagText(b, 'pubDate') ?? tagText(b, 'dc:date');
    const t = date ? Date.parse(date) : NaN;
    if (!title || !url || !Number.isFinite(t)) continue;
    out.push({ title, url, source: tagText(b, 'source') ?? defaultSource, publishedAt: new Date(t).toISOString() });
  }
  return out;
}

/** A url field that may be a string or `{ url }` (Yahoo's clickThroughUrl / canonicalUrl shape). */
function urlField(v: unknown): string | null {
  if (typeof v === 'string') return v;
  const u = (v as { url?: unknown } | null)?.url;
  return typeof u === 'string' ? u : null;
}

/**
 * Parse Yahoo's /v1/finance/search response (`news[]`). Stories only (no videos/ads). The item's
 * own publisher URL (canonicalUrl, then clickThroughUrl) wins when it points off Yahoo; otherwise
 * `link` is returned, which is a finance.yahoo.com wrapper that resolvePublisherUrl() must resolve.
 */
export function parseYahooSearchNews(json: unknown, defaultSource = 'Yahoo Finance'): NewsItem[] {
  const news = (json as { news?: unknown })?.news;
  if (!Array.isArray(news)) return [];
  const out: NewsItem[] = [];
  for (const n of news as Array<Record<string, unknown>>) {
    if (n.type && n.type !== 'STORY') continue;
    const title = typeof n.title === 'string' ? n.title.replace(/\s+/g, ' ').trim() : '';
    const direct = [urlField(n.canonicalUrl), urlField(n.clickThroughUrl)]
      .map((u) => cleanUrl(u))
      .find((u): u is string => !!u && !isYahooHost(u));
    const url = direct ?? cleanUrl(typeof n.link === 'string' ? n.link : null);
    const secs = Number(n.providerPublishTime);
    if (!title || !url || !Number.isFinite(secs) || secs <= 0) continue;
    const publisher = typeof n.publisher === 'string' && n.publisher.trim() ? n.publisher.trim() : defaultSource;
    out.push({ title, url, source: publisher, publishedAt: new Date(secs * 1000).toISOString() });
  }
  return out;
}

// ── publisher URL resolution ───────────────────────────────────────────────

/** `<link rel="canonical" href="...">` (either attribute order) from the start of an HTML page. */
export function extractCanonicalUrl(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']?canonical["']?/i.test(tag)) continue;
    const href = /\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'/i.exec(tag);
    const v = href?.[1] ?? href?.[2];
    if (v) return cleanUrl(decodeEntities(v));
  }
  return null;
}

/** Read the response until the canonical link tag has arrived (or the byte cap), then stop. */
async function readCanonical(res: Response): Promise<string | null> {
  if (!res.body) return extractCanonicalUrl((await res.text()).slice(0, RESOLVE_MAX_BYTES));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      buf += dec.decode(value, { stream: true });
      const found = extractCanonicalUrl(buf);
      if (found) return found;
      if (bytes >= RESOLVE_MAX_BYTES || /<\/head>/i.test(buf)) break;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return extractCanonicalUrl(buf);
}

/** Resolved Yahoo wrapper URL -> publisher URL (null = unresolvable). Isolate memory, bounded. */
const resolvedCache = new Map<string, string | null>();
const RESOLVED_CACHE_MAX = 300;

/**
 * Publisher URL for a news link. Non-Yahoo links are returned (cleaned). A finance.yahoo.com wrapper
 * is resolved through the page's canonical link; the result must be off Yahoo unless the item is
 * Yahoo Finance's own reporting (publisher starts with "Yahoo"). Returns null when unresolvable, so
 * the caller drops the item instead of linking to a wrapper.
 */
export async function resolvePublisherUrl(item: NewsItem, fetchImpl: typeof fetch): Promise<string | null> {
  const clean = cleanUrl(item.url);
  if (!clean) return null;
  if (!isYahooHost(clean)) return clean;
  const accept = (u: string | null): string | null =>
    u && (!isYahooHost(u) || /^yahoo/i.test(item.source)) ? u : null;
  if (resolvedCache.has(clean)) return accept(resolvedCache.get(clean) ?? null);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RESOLVE_TIMEOUT_MS);
  let canonical: string | null = null;
  try {
    const res = await fetchImpl(clean, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: ctl.signal,
      redirect: 'follow',
    });
    // A consent / error interstitial is not the article.
    if (res.ok && !/^consent\./i.test(new URL(res.url || clean).hostname)) canonical = await readCanonical(res);
  } catch {
    canonical = null;
  } finally {
    clearTimeout(timer);
  }
  if (resolvedCache.size >= RESOLVED_CACHE_MAX) resolvedCache.delete(resolvedCache.keys().next().value as string);
  // Only accepted resolutions are remembered (a transient block must be retried next refresh).
  const accepted = accept(canonical);
  if (accepted) resolvedCache.set(clean, accepted);
  return accepted;
}

export function __resetNewsResolveCacheForTests(): void {
  resolvedCache.clear();
}

// ── selection ──────────────────────────────────────────────────────────────

/**
 * Headlines that read as advice / calls rather than news. The block is plain news only, so these
 * are dropped (e.g. "3 stocks to buy now", "Should you buy X?", "Analyst upgrades Y").
 */
const ADVISORY =
  /\b(should (you|i)|stocks? to (buy|sell|watch|avoid)|best (stocks?|etfs?|dividend)|top (picks?|stocks?)|buy (now|the dip)|time to (buy|sell)|is it (a )?(buy|sell)|worth buying|(strong )?(buy|sell|hold) rating|price targets?|(up|down)grades?d?|bullish|bearish|predictions?|where will .{1,40} be in|no-brainer|millionaire)\b/i;

export function isAdvisoryHeadline(title: string): boolean {
  return ADVISORY.test(title);
}

/** Lowercased, source-suffix/punctuation-free token string used for duplicate detection. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+[-–—|]\s+[^-–—|]{2,30}$/, '') // trailing " - Reuters"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return raw;
  }
}

/**
 * Newest-first, unique, plain general-market headlines.
 * Unique = different canonical URL AND not the same story (exact normalized title, or ≥ 0.7 token
 * overlap, which catches the same wire headline re-worded by two outlets).
 * Items dated more than `futureSkewMs` in the future (bad feed clock) are dropped.
 */
export function selectTopNews(items: NewsItem[], count = NEWS_COUNT, nowMs = Date.now(), futureSkewMs = 60 * 60_000): NewsItem[] {
  const sorted = items
    .filter((i) => !isAdvisoryHeadline(i.title) && Date.parse(i.publishedAt) <= nowMs + futureSkewMs)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const picked: NewsItem[] = [];
  const urls = new Set<string>();
  const titles: Array<{ norm: string; tokens: Set<string> }> = [];
  for (const it of sorted) {
    const cu = canonicalUrl(it.url);
    const norm = normalizeTitle(it.title);
    const tokens = new Set(norm.split(' ').filter((w) => w.length > 2));
    if (urls.has(cu)) continue;
    if (titles.some((t) => t.norm === norm || jaccard(t.tokens, tokens) >= 0.7)) continue;
    urls.add(cu);
    titles.push({ norm, tokens });
    picked.push(it);
    if (picked.length >= count) break;
  }
  return picked;
}

// ── fetching + cache ───────────────────────────────────────────────────────

async function fetchSource(src: NewsSource, fetchImpl: typeof fetch): Promise<NewsItem[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(src.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: src.kind === 'rss' ? 'application/rss+xml, application/xml, text/xml' : 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`${src.name} HTTP ${res.status}`);
    const items =
      src.kind === 'rss' ? parseRss(await res.text(), src.name) : parseYahooSearchNews(await res.json(), src.name);
    return items.slice(0, PER_SOURCE_CAP);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch every source; failures are ignored as long as at least one source answered. */
export async function fetchTopNews(
  opts: { fetchImpl?: typeof fetch; now?: () => number; sources?: NewsSource[] } = {},
): Promise<NewsItem[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const settled = await Promise.allSettled((opts.sources ?? NEWS_SOURCES).map((s) => fetchSource(s, fetchImpl)));
  const ok = settled.filter((s): s is PromiseFulfilledResult<NewsItem[]> => s.status === 'fulfilled');
  if (ok.length === 0) throw new Error('all news sources failed');
  const all = ok.flatMap((s) => s.value);
  // Newest candidates first; resolve Yahoo wrappers to publisher URLs (at most MAX_RESOLVE pages),
  // dropping any that cannot be resolved, then dedupe on the publisher URLs.
  const nowMs = now();
  const candidates = all
    .filter((i) => !isAdvisoryHeadline(i.title) && Date.parse(i.publishedAt) <= nowMs + 60 * 60_000)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  let toResolve = MAX_RESOLVE;
  const resolved = await Promise.all(
    candidates.map(async (it) => {
      if (!isYahooHost(it.url)) return it;
      if (toResolve-- <= 0) return null;
      const url = await resolvePublisherUrl(it, fetchImpl);
      return url ? { ...it, url } : null;
    }),
  );
  const yahooTried = candidates.filter((i) => isYahooHost(i.url)).length;
  if (yahooTried > 0) {
    const yahooOk = resolved.filter((i) => i && candidates.some((c) => c.title === i.title && isYahooHost(c.url))).length;
    console.log(`[News] yahoo wrapper links resolved to publisher URLs: ${yahooOk}/${Math.min(yahooTried, MAX_RESOLVE)}`);
  }
  return selectTopNews(resolved.filter((i): i is NewsItem => i !== null), NEWS_COUNT, nowMs);
}

let cache: { payload: TopNewsPayload; at: number } | null = null;
let failedAt = 0;
let inFlight: Promise<TopNewsPayload | null> | null = null;

export function __resetNewsCacheForTests(): void {
  resolvedCache.clear();
  cache = null;
  failedAt = 0;
  inFlight = null;
}

/**
 * Cached top news. Fresh for NEWS_TTL_MS; concurrent callers share one fetch; on failure the last
 * good headlines are returned (stale: true) and retries are spaced by NEWS_FAIL_BACKOFF_MS.
 * Returns null only if there has never been a successful fetch.
 */
export async function getTopNews(
  opts: { fetchImpl?: typeof fetch; now?: () => number; sources?: NewsSource[] } = {},
): Promise<TopNewsPayload | null> {
  const now = (opts.now ?? Date.now)();
  if (cache && now - cache.at < NEWS_TTL_MS) return cache.payload;
  if (!cache && failedAt && now - failedAt < NEWS_FAIL_BACKOFF_MS) return null;
  if (cache && failedAt && now - failedAt < NEWS_FAIL_BACKOFF_MS) return { ...cache.payload, stale: true };
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const items = await fetchTopNews(opts);
      if (items.length === 0) throw new Error('no usable headlines');
      cache = { payload: { items, fetchedAt: new Date(now).toISOString(), stale: false }, at: now };
      failedAt = 0;
      return cache.payload;
    } catch (err) {
      failedAt = now;
      console.warn('[news] refresh failed:', err instanceof Error ? err.message : err);
      return cache ? { ...cache.payload, stale: true } : null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
