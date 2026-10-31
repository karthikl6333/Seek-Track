import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetNewsCacheForTests,
  cleanUrl,
  decodeEntities,
  extractCanonicalUrl,
  fetchTopNews,
  getTopNews,
  isAdvisoryHeadline,
  isYahooHost,
  NEWS_COUNT,
  NEWS_FAIL_BACKOFF_MS,
  NEWS_TTL_MS,
  normalizeTitle,
  parseRss,
  parseYahooSearchNews,
  resolvePublisherUrl,
  safeUrl,
  selectTopNews,
  type NewsItem,
  type NewsSource,
} from './top-news.js';

const CNBC = `<?xml version="1.0"?><rss version="2.0"><channel><title>US Top News</title>
<item><link>https://www.cnbc.com/2026/10/30/intel.html</link><metadata:sponsored>false</metadata:sponsored>
<title>Intel stock has worst day since 1970s, wiping about $12 billion off government&apos;s stake</title>
<description><![CDATA[Investors are nervous.]]></description><pubDate>Fri, 30 Oct 2026 20:30:57 GMT</pubDate></item>
<item><link>https://www.cnbc.com/2026/10/30/ad.html</link><metadata:sponsored>true</metadata:sponsored>
<title>Sponsored: great offer</title><pubDate>Fri, 30 Oct 2026 19:00:00 GMT</pubDate></item>
<item><link>https://www.cnbc.com/2026/10/30/cdata.html</link>
<title><![CDATA[Treasury announces new I bond rate & more]]></title><pubDate>Fri, 30 Oct 2026 17:15:53 GMT</pubDate></item>
<item><link>javascript:alert(1)</link><title>Evil</title><pubDate>Fri, 30 Oct 2026 17:15:53 GMT</pubDate></item>
<item><link>https://www.cnbc.com/x.html</link><title>No date</title></item>
<item><title>No link</title><pubDate>Fri, 30 Oct 2026 17:15:53 GMT</pubDate></item>
</channel></rss>`;

const MW = `<rss><channel><item><title>&#x2018;GTA 6&#x2019; fans are missing work</title>
<link>https://www.marketwatch.com/story/gta?mod=mw_rss_topstories</link>
<pubDate>Sat, 31 Oct 2026 04:30:00 GMT</pubDate></item></channel></rss>`;

const it$ = (title: string, url: string, iso: string, source = 'S'): NewsItem => ({ title, url, source, publishedAt: iso });

describe('parseRss', () => {
  const items = parseRss(CNBC, 'CNBC');
  it('extracts title/link/source/time, decodes entities + CDATA, in ISO', () => {
    expect(items.map((i) => i.title)).toEqual([
      "Intel stock has worst day since 1970s, wiping about $12 billion off government's stake",
      'Treasury announces new I bond rate & more',
    ]);
    expect(items[0]).toMatchObject({
      url: 'https://www.cnbc.com/2026/10/30/intel.html',
      source: 'CNBC',
      publishedAt: '2026-10-30T20:30:57.000Z',
    });
  });
  it('skips sponsored, non-http(s) links, items without date or link', () => {
    const all = items.map((i) => i.title).join('|');
    expect(all).not.toMatch(/Sponsored|Evil|No date|No link/);
  });
  it('keeps publisher links as-is but strips tracking params (MarketWatch ?mod=)', () => {
    expect(parseRss(MW, 'MarketWatch')[0].url).toBe('https://www.marketwatch.com/story/gta');
  });
  it('decodes numeric entities (MarketWatch)', () => {
    expect(parseRss(MW, 'MarketWatch')[0].title).toBe('\u2018GTA 6\u2019 fans are missing work');
  });
  it('returns [] for non-RSS / garbage', () => {
    expect(parseRss('<html>nope</html>', 'X')).toEqual([]);
    expect(parseRss('', 'X')).toEqual([]);
  });
});

describe('parseYahooSearchNews', () => {
  it('maps stories, drops videos/invalid, uses publisher as source', () => {
    const json = {
      news: [
        { type: 'STORY', title: ' Stocks  slide ', publisher: 'Reuters', link: 'https://finance.yahoo.com/a', providerPublishTime: 1793295300 },
        { type: 'VIDEO', title: 'clip', link: 'https://finance.yahoo.com/v', providerPublishTime: 1793295300 },
        { type: 'STORY', title: 'bad link', link: 'ftp://x', providerPublishTime: 1793295300 },
        { type: 'STORY', title: 'bad time', link: 'https://x.com/a', providerPublishTime: 'abc' },
      ],
    };
    const out = parseYahooSearchNews(json);
    expect(out).toEqual([
      { title: 'Stocks slide', url: 'https://finance.yahoo.com/a', source: 'Reuters', publishedAt: new Date(1793295300 * 1000).toISOString() },
    ]);
    expect(parseYahooSearchNews(null)).toEqual([]);
    expect(parseYahooSearchNews({ news: 'x' })).toEqual([]);
  });
});

describe('original publisher links', () => {
  it('cleanUrl strips tracking params + fragment, keeps real params, rejects non-http(s)', () => {
    expect(cleanUrl('https://www.fool.com/a/b/?utm_source=yahoo&utm_medium=feed&referring_guid=1&id=42#x')).toBe('https://www.fool.com/a/b/?id=42');
    expect(cleanUrl('https://a.com/s?fbclid=abc&guccounter=1')).toBe('https://a.com/s');
    expect(cleanUrl('javascript:alert(1)')).toBeNull();
  });
  it('isYahooHost', () => {
    expect(isYahooHost('https://finance.yahoo.com/news/x.html')).toBe(true);
    expect(isYahooHost('https://yahoo.com/x')).toBe(true);
    expect(isYahooHost('https://notyahoo.com/x')).toBe(false);
    expect(isYahooHost('https://www.fool.com/x')).toBe(false);
  });
  it('parseYahooSearchNews prefers canonicalUrl/clickThroughUrl off Yahoo, else keeps the link', () => {
    const t = 1793295300;
    const out = parseYahooSearchNews({
      news: [
        { type: 'STORY', title: 'Canonical object', publisher: 'Motley Fool', link: 'https://finance.yahoo.com/a', canonicalUrl: { url: 'https://www.fool.com/a/?utm_source=y' }, providerPublishTime: t },
        { type: 'STORY', title: 'Click through string', publisher: 'Zacks', link: 'https://finance.yahoo.com/b', clickThroughUrl: 'https://www.zacks.com/b', providerPublishTime: t },
        { type: 'STORY', title: 'Canonical is yahoo', publisher: 'Benzinga', link: 'https://finance.yahoo.com/c', canonicalUrl: { url: 'https://finance.yahoo.com/c2' }, providerPublishTime: t },
      ],
    });
    expect(out.map((i) => i.url)).toEqual(['https://www.fool.com/a/', 'https://www.zacks.com/b', 'https://finance.yahoo.com/c']);
    expect(out.map((i) => i.source)).toEqual(['Motley Fool', 'Zacks', 'Benzinga']);
  });
  it('extractCanonicalUrl handles either attribute order and entities', () => {
    expect(extractCanonicalUrl('<head><link rel="canonical" href="https://www.fool.com/x/?utm_source=a&amp;id=1"></head>')).toBe('https://www.fool.com/x/?id=1');
    expect(extractCanonicalUrl("<link href='https://a.com/y' rel='canonical'/>")).toBe('https://a.com/y');
    expect(extractCanonicalUrl('<link rel="stylesheet" href="https://a.com/s.css"><title>x</title>')).toBeNull();
  });

  const wrapper: NewsItem = { title: 'T', url: 'https://finance.yahoo.com/markets/stocks/articles/x-1.html', source: 'Motley Fool', publishedAt: '2026-10-31T01:00:00Z' };
  const page = (canonical: string) =>
    `<html><head><title>x</title><link rel="canonical" href="${canonical}"></head><body>${'x'.repeat(5000)}</body></html>`;
  beforeEach(() => __resetNewsCacheForTests());

  it('resolves a finance.yahoo.com wrapper to the publisher canonical URL, once (cached)', async () => {
    const f = vi.fn(async () => new Response(page('https://www.fool.com/investing/2026/10/29/x/'), { status: 200 }));
    expect(await resolvePublisherUrl(wrapper, f as never)).toBe('https://www.fool.com/investing/2026/10/29/x/');
    expect(await resolvePublisherUrl(wrapper, f as never)).toBe('https://www.fool.com/investing/2026/10/29/x/');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('leaves non-Yahoo links alone (no fetch)', async () => {
    const f = vi.fn();
    expect(await resolvePublisherUrl({ ...wrapper, url: 'https://www.cnbc.com/a.html?__source=x&utm_term=1' }, f as never)).toBe('https://www.cnbc.com/a.html?__source=x');
    expect(f).not.toHaveBeenCalled();
  });
  it('returns null (item dropped) when blocked, no canonical, or the canonical is still Yahoo', async () => {
    const blocked = vi.fn(async () => new Response('x', { status: 429 }));
    expect(await resolvePublisherUrl(wrapper, blocked as never)).toBeNull();
    const none = vi.fn(async () => new Response('<html><head></head></html>', { status: 200 }));
    expect(await resolvePublisherUrl(wrapper, none as never)).toBeNull();
    const boom = vi.fn(async () => { throw new Error('net'); });
    expect(await resolvePublisherUrl(wrapper, boom as never)).toBeNull();
    const yahoo = vi.fn(async () => new Response(page('https://finance.yahoo.com/x-1.html'), { status: 200 }));
    expect(await resolvePublisherUrl(wrapper, yahoo as never)).toBeNull();
    // failures are not cached: a later success resolves
    const ok = vi.fn(async () => new Response(page('https://www.fool.com/ok/'), { status: 200 }));
    expect(await resolvePublisherUrl(wrapper, ok as never)).toBe('https://www.fool.com/ok/');
  });
  it('allows a Yahoo-hosted canonical only for Yahoo Finance\'s own reporting', async () => {
    const f = vi.fn(async () => new Response(page('https://finance.yahoo.com/news/own-1.html'), { status: 200 }));
    expect(await resolvePublisherUrl({ ...wrapper, source: 'Yahoo Finance' }, f as never)).toBe('https://finance.yahoo.com/news/own-1.html');
  });
});

describe('top 5 end to end', () => {
  const at = Date.parse('2026-10-31T06:00:00Z');
  const sources: NewsSource[] = [
    { name: 'CNBC', url: 'https://cnbc.test/rss', kind: 'rss' },
    { name: 'MarketWatch', url: 'https://mw.test/rss', kind: 'rss' },
    { name: 'Yahoo Finance', url: 'https://yahoo.test/search', kind: 'yahoo-search' },
  ];
  beforeEach(() => {
    __resetNewsCacheForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns 5 items, every link on the publisher (no Yahoo wrappers), deduped, publisher as source', async () => {
    const story = (title: string, slug: string, publisher: string, iso: string) => ({
      type: 'STORY', title, publisher, link: `https://finance.yahoo.com/markets/stocks/articles/${slug}.html`, providerPublishTime: Date.parse(iso) / 1000,
    });
    const yahooNews = [
      story('Oil climbs as Gulf supply worries grow', 'oil-1', 'Reuters', '2026-10-31T04:00:00Z'),
      story('Retail sales rise more than expected in October', 'retail-2', 'Associated Press', '2026-10-31T03:30:00Z'),
      story('Unresolvable wrapper story about crypto rules', 'crypto-3', 'Decrypt', '2026-10-31T03:00:00Z'),
      story('Intel stock has worst day since 1970s, wiping about $12 billion off government stake', 'intel-4', 'CNBC', '2026-10-31T02:00:00Z'),
      story('Chipmakers slide as export curbs widen', 'chips-5', 'Bloomberg', '2026-10-31T01:30:00Z'),
    ];
    const canon: Record<string, string> = {
      'oil-1': 'https://www.reuters.com/markets/oil-1/?utm_source=yahoo',
      'retail-2': 'https://apnews.com/article/retail-2',
      'intel-4': 'https://www.cnbc.com/2026/10/30/intel.html', // same story as the CNBC RSS item -> deduped
      'chips-5': 'https://www.bloomberg.com/news/chips-5',
    };
    const f = vi.fn(async (url: string) => {
      if (url.includes('cnbc.test')) return new Response(CNBC, { status: 200 });
      if (url.includes('mw.test')) return new Response(MW, { status: 200 });
      if (url.includes('yahoo.test')) return new Response(JSON.stringify({ news: yahooNews }), { status: 200 });
      const slug = /articles\/(.+)\.html/.exec(url)?.[1] ?? '';
      if (!canon[slug]) return new Response('blocked', { status: 429 });
      return new Response(`<head><link rel="canonical" href="${canon[slug]}"></head>`, { status: 200 });
    });
    const items = await fetchTopNews({ fetchImpl: f as never, sources, now: () => at });
    expect(items).toHaveLength(5);
    for (const i of items) {
      expect(isYahooHost(i.url), i.url).toBe(false);
      expect(i.url).not.toMatch(/utm_|\?mod=/);
    }
    expect(items.map((i) => i.url)).toEqual([
      'https://www.marketwatch.com/story/gta',
      'https://www.reuters.com/markets/oil-1/',
      'https://apnews.com/article/retail-2',
      'https://www.cnbc.com/2026/10/30/intel.html',
      'https://www.bloomberg.com/news/chips-5',
    ]);
    expect(items.map((i) => i.source)).toEqual(['MarketWatch', 'Reuters', 'Associated Press', 'CNBC', 'Bloomberg']);
    expect(new Set(items.map((i) => i.url)).size).toBe(5);
  });
});

describe('helpers', () => {
  it('safeUrl allows only http(s)', () => {
    expect(safeUrl('https://a.com/x')).toBe('https://a.com/x');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('nonsense')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
  it('decodeEntities', () => {
    expect(decodeEntities('A &amp; B &#39;x&#39; &#x2019; &unknown;')).toBe("A & B 'x' \u2019 &unknown;");
  });
  it('advisory headlines are flagged; ordinary news is not', () => {
    for (const t of [
      '3 stocks to buy now',
      'Should you buy Nvidia before earnings?',
      'Analyst upgrades Tesla to buy',
      'Best dividend stocks for 2027',
      'Where Will VTI Be in 2046? Here’s What 25 Years of History Suggests',
      'Wall Street is bearish on chips',
    ]) expect(isAdvisoryHeadline(t), t).toBe(true);
    for (const t of [
      'Intel stock has worst day since 1970s',
      'Treasury announces new Series I bond rate of 5.51%',
      'Amazon buys robotics startup for $1 billion',
      'Fed holds rates steady',
    ]) expect(isAdvisoryHeadline(t), t).toBe(false);
  });
  it('normalizeTitle strips a trailing source and punctuation', () => {
    expect(normalizeTitle('Fed holds rates steady - Reuters')).toBe('fed holds rates steady');
    expect(normalizeTitle('Fed holds rates, steady!')).toBe('fed holds rates steady');
  });
});

describe('selectTopNews (recency, dedupe, filtering)', () => {
  const now = Date.parse('2026-10-31T06:00:00Z');
  it('returns the 3 most recent when asked for 3, newest first', () => {
    const items = [
      it$('Old story about oil prices', 'https://a.com/1', '2026-10-29T10:00:00Z'),
      it$('Newest story on bond yields', 'https://a.com/2', '2026-10-31T05:00:00Z'),
      it$('Middle story on jobs report', 'https://a.com/3', '2026-10-30T12:00:00Z'),
      it$('Another story on housing starts', 'https://a.com/4', '2026-10-30T20:00:00Z'),
    ];
    expect(selectTopNews(items, 3, now).map((i) => i.url)).toEqual(['https://a.com/2', 'https://a.com/4', 'https://a.com/3']);
  });
  it('dedupes the same URL (ignoring www, trailing slash, query)', () => {
    const items = [
      it$('Story one about markets today', 'https://www.a.com/s/1/?mod=rss', '2026-10-31T05:00:00Z'),
      it$('Totally different words here now', 'https://a.com/s/1', '2026-10-31T04:00:00Z'),
    ];
    expect(selectTopNews(items, 3, now)).toHaveLength(1);
  });
  it('dedupes the same headline across outlets (exact and re-worded), keeping the newest', () => {
    const items = [
      it$('Fed holds interest rates steady as inflation cools', 'https://cnbc.com/a', '2026-10-31T05:00:00Z', 'CNBC'),
      it$('Fed holds interest rates steady as inflation cools - Reuters', 'https://yahoo.com/b', '2026-10-31T04:00:00Z', 'Yahoo'),
      it$('Fed holds interest rates steady, inflation cools', 'https://mw.com/c', '2026-10-31T03:00:00Z', 'MW'),
      it$('Oil jumps after surprise OPEC output cut', 'https://cnbc.com/d', '2026-10-31T02:00:00Z', 'CNBC'),
    ];
    const out = selectTopNews(items, 3, now);
    expect(out.map((i) => i.source)).toEqual(['CNBC', 'CNBC']);
    expect(out[0].url).toBe('https://cnbc.com/a');
  });
  it('drops advisory headlines and far-future dated items', () => {
    const items = [
      it$('3 stocks to buy now', 'https://a.com/1', '2026-10-31T05:30:00Z'),
      it$('Clock-skewed story from the future', 'https://a.com/2', '2026-11-05T05:30:00Z'),
      it$('Plain news item about trade talks', 'https://a.com/3', '2026-10-31T05:00:00Z'),
    ];
    expect(selectTopNews(items, 3, now).map((i) => i.url)).toEqual(['https://a.com/3']);
  });
  it('returns fewer than requested when fewer exist, and [] for []', () => {
    expect(selectTopNews([], 3, now)).toEqual([]);
  });
});

describe('fetching + cache', () => {
  const sources: NewsSource[] = [
    { name: 'CNBC', url: 'https://cnbc.test/rss', kind: 'rss' },
    { name: 'MarketWatch', url: 'https://mw.test/rss', kind: 'rss' },
    { name: 'Yahoo Finance', url: 'https://yahoo.test/search', kind: 'yahoo-search' },
  ];
  const xmlRes = (x: string) => new Response(x, { status: 200 });
  const happy = () =>
    vi.fn(async (url: string) => {
      if (url.includes('cnbc')) return xmlRes(CNBC);
      if (url.includes('mw.test')) return xmlRes(MW);
      return new Response(
        JSON.stringify({ news: [{ type: 'STORY', title: 'Stocks wobble ahead of jobs data', publisher: 'Yahoo', link: 'https://y.com/1', providerPublishTime: Date.parse('2026-10-31T01:00:00Z') / 1000 }] }),
        { status: 200 },
      );
    });
  const at = Date.parse('2026-10-31T06:00:00Z');
  beforeEach(() => {
    __resetNewsCacheForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('merges all sources, newest first, up to 5', async () => {
    const items = await fetchTopNews({ fetchImpl: happy() as never, sources, now: () => at });
    expect(items.map((i) => i.source)).toEqual(['MarketWatch', 'Yahoo', 'CNBC', 'CNBC']);
    expect(NEWS_COUNT).toBe(5);
  });

  it('survives one or two failing feeds; throws only if all fail', async () => {
    const oneDown = vi.fn(async (url: string) => (url.includes('cnbc') ? xmlRes(CNBC) : new Response('x', { status: 503 })));
    expect((await fetchTopNews({ fetchImpl: oneDown as never, sources, now: () => at })).length).toBeGreaterThan(0);
    const allDown = vi.fn(async () => new Response('x', { status: 500 }));
    await expect(fetchTopNews({ fetchImpl: allDown as never, sources, now: () => at })).rejects.toThrow(/all news sources failed/);
  });

  it('caches for 15 min (one fetch round), then refetches', async () => {
    const f = happy();
    const o = { fetchImpl: f as never, sources };
    const a = await getTopNews({ ...o, now: () => at });
    await getTopNews({ ...o, now: () => at + NEWS_TTL_MS - 1000 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(a?.stale).toBe(false);
    await getTopNews({ ...o, now: () => at + NEWS_TTL_MS + 1 });
    expect(f).toHaveBeenCalledTimes(6);
  });

  it('shares one in-flight fetch between concurrent callers', async () => {
    const f = happy();
    const o = { fetchImpl: f as never, sources, now: () => at };
    await Promise.all([getTopNews(o), getTopNews(o), getTopNews(o)]);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('on failure keeps serving the last headlines (stale) and backs off retries', async () => {
    const good = await getTopNews({ fetchImpl: happy() as never, sources, now: () => at });
    const down = vi.fn(async () => new Response('x', { status: 500 }));
    const t2 = at + NEWS_TTL_MS + 1;
    const stale = await getTopNews({ fetchImpl: down as never, sources, now: () => t2 });
    expect(stale?.items).toEqual(good?.items);
    expect(stale?.stale).toBe(true);
    const calls = down.mock.calls.length;
    await getTopNews({ fetchImpl: down as never, sources, now: () => t2 + 1000 });
    expect(down.mock.calls.length).toBe(calls); // inside the backoff window
    const later = await getTopNews({ fetchImpl: happy() as never, sources, now: () => t2 + NEWS_FAIL_BACKOFF_MS + 1 });
    expect(later?.stale).toBe(false);
  });

  it('returns null when it has never succeeded (client hides the block)', async () => {
    const down = vi.fn(async () => new Response('x', { status: 500 }));
    expect(await getTopNews({ fetchImpl: down as never, sources, now: () => at })).toBeNull();
  });
});

describe('no D1', () => {
  it('news modules never import the database layer', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const f of [join(here, 'top-news.ts'), join(here, '..', 'routes', 'news.ts')]) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/from ['"][./]*(db|db-d1)\.js['"]|\bquery\(/);
    }
  });
});
