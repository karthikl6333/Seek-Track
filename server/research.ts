import type { Context } from 'hono';
import { query } from './db.js';
import { fetchYahooMeta } from './quotes.js';
import { parseLeverageFromName, guessUnderlying } from './pairs.js';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const USER_AGENT =
  'Mozilla/5.0 (compatible; SeekTrack/1.0; +https://github.com/karthikl6333/Seek-Track)';

export interface UniverseRow {
  symbol: string;
  name: string;
  sortOrder: number;
  sectorNote: string;
}

export interface EtfMapRow {
  underlying: string;
  etf: string;
  direction: 'bull' | 'bear';
  factor: number;
  source: string;
  updatedAt: string;
}

export interface QuoteSnap {
  symbol: string;
  price: number | null;
  dayPct: number | null;
  updatedAt: string | null;
  source?: string;
}

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string | null;
  url: string;
}

export interface ChartPoint {
  date: string;
  [symbol: string]: string | number | null;
}

/** Seed universe — editable via DB later. */
export const RESEARCH_UNIVERSE: UniverseRow[] = [
  { symbol: 'NVDA', name: 'NVIDIA', sortOrder: 1, sectorNote: 'GPU / AI' },
  { symbol: 'AVGO', name: 'Broadcom', sortOrder: 2, sectorNote: 'Semiconductors' },
  { symbol: 'TSM', name: 'TSMC', sortOrder: 3, sectorNote: 'Foundry' },
  { symbol: 'ASML', name: 'ASML', sortOrder: 4, sectorNote: 'Lithography' },
  { symbol: 'AMD', name: 'AMD', sortOrder: 5, sectorNote: 'CPU / GPU' },
  { symbol: 'MU', name: 'Micron', sortOrder: 6, sectorNote: 'Memory' },
  { symbol: 'INTC', name: 'Intel', sortOrder: 7, sectorNote: 'CPU / Foundry' },
  { symbol: 'QCOM', name: 'Qualcomm', sortOrder: 8, sectorNote: 'Mobile / RF' },
  { symbol: 'AMAT', name: 'Applied Materials', sortOrder: 9, sectorNote: 'Equipment' },
  { symbol: 'LRCX', name: 'Lam Research', sortOrder: 10, sectorNote: 'Equipment' },
];

/**
 * Curated single-stock leveraged/inverse ETFs verified via Yahoo quote names (2026-09).
 * Prefer one primary bull + one primary bear per underlying when available.
 */
export const RESEARCH_SEED_MAPS: Array<{
  underlying: string;
  etf: string;
  direction: 'bull' | 'bear';
  factor: number;
}> = [
  { underlying: 'NVDA', etf: 'NVDL', direction: 'bull', factor: 2 },
  { underlying: 'NVDA', etf: 'NVD', direction: 'bear', factor: -2 },
  { underlying: 'AVGO', etf: 'AVL', direction: 'bull', factor: 2 },
  { underlying: 'AVGO', etf: 'AVS', direction: 'bear', factor: -1 },
  { underlying: 'TSM', etf: 'TSMX', direction: 'bull', factor: 2 },
  { underlying: 'TSM', etf: 'TSMZ', direction: 'bear', factor: -1 },
  { underlying: 'ASML', etf: 'ASMG', direction: 'bull', factor: 2 },
  { underlying: 'AMD', etf: 'AMDL', direction: 'bull', factor: 2 },
  { underlying: 'AMD', etf: 'AMDS', direction: 'bear', factor: -1 },
  { underlying: 'MU', etf: 'MULL', direction: 'bull', factor: 2 },
  { underlying: 'MU', etf: 'MUZ', direction: 'bear', factor: -2 },
  { underlying: 'INTC', etf: 'INTW', direction: 'bull', factor: 2 },
  { underlying: 'QCOM', etf: 'QCML', direction: 'bull', factor: 2 },
  { underlying: 'AMAT', etf: 'AMA', direction: 'bull', factor: 2 },
  { underlying: 'LRCX', etf: 'LRCU', direction: 'bull', factor: 2 },
  // Sandisk / Tradr 2x Long + Short SNDK
  { underlying: 'SNDK', etf: 'SNXX', direction: 'bull', factor: 2 },
  { underlying: 'SNDK', etf: 'SNDQ', direction: 'bear', factor: -2 },
];

/** Extra candidates to probe via Yahoo name heuristics (discovery). */
const DISCOVERY_CANDIDATES: Record<string, string[]> = {
  NVDA: ['NVDU', 'NVDD', 'NVDQ'],
  AVGO: [],
  TSM: ['TSMU', 'TSMG'],
  ASML: [],
  AMD: [],
  MU: [],
  INTC: [],
  QCOM: ['QCMU'],
  AMAT: ['AMAU'],
  LRCX: [],
  SNDK: ['SNXX', 'SNDQ'],
};

let researchRefreshInFlight: Promise<unknown> | null = null;
let lastResearchRefreshAt: string | null = null;

async function fetchYahooQuoteFull(symbol: string): Promise<{
  price: number;
  dayPct: number | null;
  shortName: string | null;
  longName: string | null;
}> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  const data = (await res.json()) as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          previousClose?: number;
          chartPreviousClose?: number;
          regularMarketChangePercent?: number;
          shortName?: string;
          longName?: string;
        };
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
      error?: { description?: string } | null;
    };
  };
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) throw new Error(data.chart?.error?.description || `No quote for ${symbol}`);
  const price =
    meta.regularMarketPrice ?? meta.previousClose ?? meta.chartPreviousClose ?? null;
  if (price === null || !Number.isFinite(price)) throw new Error(`No price for ${symbol}`);

  let dayPct =
    typeof meta.regularMarketChangePercent === 'number'
      ? meta.regularMarketChangePercent
      : null;

  if (dayPct === null) {
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && Number.isFinite(c));
    if (valid.length >= 2) {
      const prev = valid[valid.length - 2];
      const last = valid[valid.length - 1];
      if (prev) dayPct = ((last - prev) / prev) * 100;
    } else if (meta.chartPreviousClose && meta.chartPreviousClose !== 0) {
      dayPct = ((Number(price) - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
    }
  }

  return {
    price: Number(price),
    dayPct: dayPct !== null && Number.isFinite(dayPct) ? dayPct : null,
    shortName: meta.shortName ?? null,
    longName: meta.longName ?? null,
  };
}

export async function upsertMarkWithDayPct(
  symbol: string,
  price: number,
  dayPct: number | null,
  source: string,
): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO marks (symbol, price, updated_at, source, day_pct)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (symbol) DO UPDATE SET
       price = EXCLUDED.price,
       updated_at = EXCLUDED.updated_at,
       source = EXCLUDED.source,
       day_pct = EXCLUDED.day_pct`,
    [symbol.toUpperCase(), price, now, source, dayPct],
  );
}

async function listUniverse(): Promise<UniverseRow[]> {
  const res = await query<{
    symbol: string;
    name: string;
    sort_order: number;
    sector_note: string;
  }>(`SELECT * FROM research_universe ORDER BY sort_order ASC, symbol ASC`);
  return res.rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    sortOrder: Number(r.sort_order),
    sectorNote: r.sector_note,
  }));
}

async function listMaps(underlying?: string): Promise<EtfMapRow[]> {
  const res = underlying
    ? await query<{
        underlying: string;
        etf: string;
        direction: string;
        factor: number;
        source: string;
        updated_at: Date | string;
      }>(
        `SELECT * FROM research_etf_map WHERE underlying = $1 ORDER BY direction, abs(factor) DESC, etf`,
        [underlying.toUpperCase()],
      )
    : await query<{
        underlying: string;
        etf: string;
        direction: string;
        factor: number;
        source: string;
        updated_at: Date | string;
      }>(`SELECT * FROM research_etf_map ORDER BY underlying, direction, abs(factor) DESC, etf`);

  return res.rows.map((r) => ({
    underlying: r.underlying,
    etf: r.etf,
    direction: r.direction as 'bull' | 'bear',
    factor: Number(r.factor),
    source: r.source,
    updatedAt:
      typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString(),
  }));
}

export async function ensureResearchSeeded(): Promise<void> {
  // Seed defaults only when the universe table is empty.
  // If the user removed a seeded ticker, a re-INSERT would bring it back on every GET —
  // so never re-insert universe rows once the table has any data.
  const countRes = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM research_universe`,
  );
  const count = Number(countRes.rows[0]?.n ?? 0);
  if (count === 0) {
    for (const u of RESEARCH_UNIVERSE) {
      await query(
        `INSERT INTO research_universe (symbol, name, sort_order, sector_note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (symbol) DO NOTHING`,
        [u.symbol, u.name, u.sortOrder, u.sectorNote],
      );
    }
  }

  const present = new Set((await listUniverse()).map((u) => u.symbol));

  for (const m of RESEARCH_SEED_MAPS) {
    if (!present.has(m.underlying)) continue;
    await query(
      `INSERT INTO research_etf_map (underlying, etf, direction, factor, source, updated_at)
       VALUES ($1, $2, $3, $4, 'seed', NOW())
       ON CONFLICT (underlying, etf) DO UPDATE SET
         direction = EXCLUDED.direction,
         factor = EXCLUDED.factor,
         source = CASE
           WHEN research_etf_map.source = 'override' THEN research_etf_map.source
           ELSE EXCLUDED.source
         END,
         updated_at = NOW()`,
      [m.underlying, m.etf, m.direction, m.factor],
    );

    // Keep pair_cache in sync for CrossCheck / pair resolver
    await query(
      `INSERT INTO pair_cache (etf, underlying, factor, theme, source, raw_name, resolved_at)
       VALUES ($1, $2, $3, $4, 'seed', NULL, NOW())
       ON CONFLICT (etf) DO NOTHING`,
      [m.etf, m.underlying, m.factor, `${m.underlying} family`],
    );
  }
}

async function getMarksMap(symbols: string[]): Promise<Record<string, QuoteSnap>> {
  if (!symbols.length) return {};
  const res = await query<{
    symbol: string;
    price: number;
    updated_at: Date | string;
    source: string | null;
    day_pct: number | null;
  }>(
    `SELECT symbol, price, updated_at, source, day_pct FROM marks WHERE symbol = ANY($1)`,
    [symbols.map((s) => s.toUpperCase())],
  );
  const out: Record<string, QuoteSnap> = {};
  for (const r of res.rows) {
    out[r.symbol] = {
      symbol: r.symbol,
      price: Number(r.price),
      dayPct: r.day_pct !== null && r.day_pct !== undefined ? Number(r.day_pct) : null,
      updatedAt:
        typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString(),
      source: r.source ?? 'manual',
    };
  }
  return out;
}

function pickPrimary(maps: EtfMapRow[], direction: 'bull' | 'bear'): EtfMapRow | null {
  const list = maps.filter((m) => m.direction === direction);
  if (!list.length) return null;
  // Prefer seed, then larger abs(factor)
  list.sort((a, b) => {
    const seedDiff = (a.source === 'seed' ? 0 : 1) - (b.source === 'seed' ? 0 : 1);
    if (seedDiff !== 0) return seedDiff;
    return Math.abs(b.factor) - Math.abs(a.factor);
  });
  return list[0];
}

async function saveDiscoveredMap(
  underlying: string,
  etf: string,
  direction: 'bull' | 'bear',
  factor: number,
  source: string,
): Promise<void> {
  await query(
    `INSERT INTO research_etf_map (underlying, etf, direction, factor, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (underlying, etf) DO UPDATE SET
       direction = EXCLUDED.direction,
       factor = EXCLUDED.factor,
       source = CASE
         WHEN research_etf_map.source IN ('seed', 'override') THEN research_etf_map.source
         ELSE EXCLUDED.source
       END,
       updated_at = NOW()`,
    [underlying.toUpperCase(), etf.toUpperCase(), direction, factor, source],
  );
  await query(
    `INSERT INTO pair_cache (etf, underlying, factor, theme, source, raw_name, resolved_at)
     VALUES ($1, $2, $3, $4, $5, NULL, NOW())
     ON CONFLICT (etf) DO UPDATE SET
       underlying = EXCLUDED.underlying,
       factor = EXCLUDED.factor,
       theme = EXCLUDED.theme,
       resolved_at = NOW()
       WHERE pair_cache.source NOT IN ('override')`,
    [etf.toUpperCase(), underlying.toUpperCase(), factor, `${underlying} family`, source],
  );
}

/** Probe candidate tickers and Yahoo search for one underlying. */
export async function discoverMapsForSymbol(symbol: string): Promise<{ discovered: string[] }> {
  const discovered: string[] = [];
  const sym = symbol.toUpperCase();
  const universe = await listUniverse();
  const u = universe.find((x) => x.symbol === sym) ?? {
    symbol: sym,
    name: sym,
    sortOrder: 0,
    sectorNote: '',
  };

  // Always ensure curated seed maps for this underlying are present
  for (const m of RESEARCH_SEED_MAPS.filter((x) => x.underlying === u.symbol)) {
    await query(
      `INSERT INTO research_etf_map (underlying, etf, direction, factor, source, updated_at)
       VALUES ($1, $2, $3, $4, 'seed', NOW())
       ON CONFLICT (underlying, etf) DO UPDATE SET
         direction = EXCLUDED.direction,
         factor = EXCLUDED.factor,
         source = CASE
           WHEN research_etf_map.source = 'override' THEN research_etf_map.source
           ELSE EXCLUDED.source
         END,
         updated_at = NOW()`,
      [m.underlying, m.etf, m.direction, m.factor],
    );
    discovered.push(`${m.etf}->${m.underlying}(seed)`);
  }

  const existing = await listMaps(u.symbol);
  // Import any already-known pairs from pair_cache (calculator seeds / prior resolves)
  const cached = await query<{
    etf: string;
    underlying: string;
    factor: number;
    source: string;
  }>(
    `SELECT etf, underlying, factor, source FROM pair_cache
     WHERE UPPER(underlying) = $1 OR UPPER(etf) = $1`,
    [u.symbol],
  );
  for (const row of cached.rows) {
    const etf = row.etf.toUpperCase();
    const under = row.underlying.toUpperCase();
    if (under !== u.symbol) continue; // only maps where this symbol is the underlying
    if (existing.some((m) => m.etf === etf)) continue;
    const factor = Number(row.factor);
    const direction: 'bull' | 'bear' = factor < 0 ? 'bear' : 'bull';
    await saveDiscoveredMap(u.symbol, etf, direction, factor, row.source || 'pair_cache');
    discovered.push(`${etf}->${u.symbol}`);
    existing.push({
      underlying: u.symbol,
      etf,
      direction,
      factor,
      source: row.source || 'pair_cache',
      updatedAt: new Date().toISOString(),
    });
  }

  const candidates = DISCOVERY_CANDIDATES[u.symbol] ?? [];

  // Common single-stock ETF ticker patterns (probe both sides every add/refresh)
  const patterns: string[] = [
    `${u.symbol}L`,
    `${u.symbol}U`,
    `${u.symbol}X`,
    `${u.symbol}S`,
    `${u.symbol}Z`,
    `${u.symbol}D`,
    `${u.symbol}Q`,
    `${u.symbol}W`,
  ];
  // Tradr-style shortenings (e.g. SNDK → SNXX / SNDQ)
  if (u.symbol.length >= 4) {
    const stem3 = u.symbol.slice(0, 3);
    const stem2 = u.symbol.slice(0, 2);
    patterns.push(`${stem3}Q`, `${stem3}X`, `${stem3}L`, `${stem3}S`);
    patterns.push(`${stem2}XX`, `${stem2}XQ`, `${stem2}XL`);
  }

  const toTry = Array.from(new Set([...candidates, ...patterns])).filter(
    (t) => t !== u.symbol && !existing.some((m) => m.etf === t),
  );

  for (const cand of toTry) {
    try {
      const meta = await fetchYahooMeta(cand);
      const name = meta.longName || meta.shortName || '';
      if (!name) continue;
      const { factor, bull } = parseLeverageFromName(name);
      const under = guessUnderlying(name, cand) ?? u.symbol;
      if (under !== u.symbol) continue;
      if (factor === null || bull === null) continue;
      const direction: 'bull' | 'bear' = bull ? 'bull' : 'bear';
      let f = factor;
      if (direction === 'bear' && f > 0) f = -f;
      if (direction === 'bull' && f < 0) f = Math.abs(f);
      await saveDiscoveredMap(u.symbol, cand, direction, f, 'yahoo');
      discovered.push(`${cand}->${u.symbol}`);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      // candidate missing / not an ETF
    }
  }

  // Broad Yahoo search — always run on add/refresh so we pick up ALL linked ETFs
  const searchQueries = [
    `2x ${u.symbol}`,
    `2x Long ${u.symbol}`,
    `2x Short ${u.symbol}`,
    `-2x ${u.symbol}`,
    `Long ${u.symbol} Daily ETF`,
    `Short ${u.symbol} Daily ETF`,
    `Tradr ${u.symbol}`,
    `Direxion ${u.symbol}`,
    `${u.name} 2x ETF`,
  ];
  const known = await listMaps(u.symbol);
  for (const queryText of searchQueries) {
    try {
      const q = encodeURIComponent(queryText);
      const res = await fetch(
        `https://query2.finance.yahoo.com/v1/finance/search?q=${q}&quotesCount=12&newsCount=0`,
        { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; quoteType?: string }>;
      };
      for (const quote of data.quotes ?? []) {
        const etfSym = (quote.symbol || '').toUpperCase();
        // Skip Yahoo currency / composite suffixes (SNXX-USD, etc.)
        if (!etfSym || etfSym === u.symbol || etfSym.includes('.') || etfSym.includes('-')) continue;
        if (known.some((m) => m.etf === etfSym)) continue;
        const name = quote.longname || quote.shortname || '';
        const { factor, bull } = parseLeverageFromName(name);
        let under = guessUnderlying(name, etfSym);
        // Accept if name clearly references the underlying ticker/company
        const nameUp = name.toUpperCase();
        const mentionsUnder =
          nameUp.includes(u.symbol) ||
          (u.name.length > 2 && nameUp.includes(u.name.toUpperCase().split(' ')[0]!));
        if (!under && mentionsUnder) under = u.symbol;
        if (under !== u.symbol || factor === null || bull === null) continue;
        const direction: 'bull' | 'bear' = bull ? 'bull' : 'bear';
        let f = factor;
        if (direction === 'bear' && f > 0) f = -f;
        if (direction === 'bull' && f < 0) f = Math.abs(f);
        try {
          await fetchYahooMeta(etfSym);
          await saveDiscoveredMap(u.symbol, etfSym, direction, f, 'yahoo');
          discovered.push(`${etfSym}->${u.symbol}`);
          known.push({
            underlying: u.symbol,
            etf: etfSym,
            direction,
            factor: f,
            source: 'yahoo',
            updatedAt: new Date().toISOString(),
          });
        } catch {
          // skip dead tickers
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    } catch {
      // search best-effort
    }
  }

  return { discovered };
}

/** Probe candidate tickers and Yahoo search; persist verified single-stock ETFs. */
export async function discoverMapsForUniverse(): Promise<{ discovered: string[] }> {
  const discovered: string[] = [];
  const universe = await listUniverse();
  for (const u of universe) {
    const d = await discoverMapsForSymbol(u.symbol);
    discovered.push(...d.discovered);
  }
  return { discovered };
}

export async function refreshResearchQuotes(): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  refreshedAt: string;
}> {
  if (researchRefreshInFlight) {
    await researchRefreshInFlight;
  }

  const run = (async () => {
    await ensureResearchSeeded();
    const universe = await listUniverse();
    const maps = await listMaps();
    const symbols = Array.from(
      new Set([...universe.map((u) => u.symbol), ...maps.map((m) => m.etf)]),
    );
    const updated: string[] = [];
    const failed: string[] = [];

    for (const symbol of symbols) {
      try {
        const q = await fetchYahooQuoteFull(symbol);
        await upsertMarkWithDayPct(symbol, q.price, q.dayPct, 'yahoo');
        updated.push(symbol);
        await new Promise((r) => setTimeout(r, 80));
      } catch {
        failed.push(symbol);
      }
    }

    lastResearchRefreshAt = new Date().toISOString();
    return {
      ok: updated.length > 0,
      updated,
      failed,
      refreshedAt: lastResearchRefreshAt,
    };
  })();

  researchRefreshInFlight = run.finally(() => {
    researchRefreshInFlight = null;
  });
  return run as Promise<{
    ok: boolean;
    updated: string[];
    failed: string[];
    refreshedAt: string;
  }>;
}

export async function refreshQuotesForSymbols(symbols: string[]): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  refreshedAt: string;
}> {
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean)));
  const updated: string[] = [];
  const failed: string[] = [];
  for (const symbol of unique) {
    try {
      const q = await fetchYahooQuoteFull(symbol);
      await upsertMarkWithDayPct(symbol, q.price, q.dayPct, 'yahoo');
      updated.push(symbol);
      await new Promise((r) => setTimeout(r, 80));
    } catch {
      failed.push(symbol);
    }
  }
  const refreshedAt = new Date().toISOString();
  if (updated.length) lastResearchRefreshAt = refreshedAt;
  return { ok: updated.length > 0, updated, failed, refreshedAt };
}

export async function fetchChartSeries(
  symbols: string[],
  range = '3mo',
): Promise<{ dates: string[]; series: Record<string, Array<number | null>> }> {
  const series: Record<string, Array<number | null>> = {};
  let dates: string[] = [];

  for (const symbol of symbols) {
    try {
      const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) {
        series[symbol] = [];
        continue;
      }
      const data = (await res.json()) as {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
        };
      };
      const result = data.chart?.result?.[0];
      const ts = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const localDates = ts.map((t) => new Date(t * 1000).toISOString().slice(0, 10));
      if (!dates.length || localDates.length > dates.length) {
        dates = localDates;
      }
      const byDate = new Map<string, number | null>();
      for (let i = 0; i < localDates.length; i++) {
        const c = closes[i];
        byDate.set(localDates[i], c != null && Number.isFinite(c) ? Number(c) : null);
      }
      series[symbol] = dates.map((d) => byDate.get(d) ?? null);
      await new Promise((r) => setTimeout(r, 60));
    } catch {
      series[symbol] = [];
    }
  }

  return { dates, series };
}

function buildChartPoints(
  dates: string[],
  series: Record<string, Array<number | null>>,
): ChartPoint[] {
  return dates.map((date, i) => {
    const point: ChartPoint = { date };
    for (const [sym, values] of Object.entries(series)) {
      point[sym] = values[i] ?? null;
    }
    return point;
  });
}

export async function fetchNewsForSymbol(
  symbol: string,
  companyName: string,
): Promise<{ items: NewsItem[]; error?: string }> {
  const queryText = encodeURIComponent(`${symbol} OR "${companyName}" stock`);
  const url = `https://news.google.com/rss/search?q=${queryText}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) {
      return { items: [], error: `News fetch HTTP ${res.status}` };
    }
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
    for (const block of itemBlocks.slice(0, 10)) {
      const title = decodeXml(
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
          block.match(/<title>(.*?)<\/title>/)?.[1] ||
          '').trim(),
      );
      const link = (
        block.match(/<link>(.*?)<\/link>/)?.[1] ||
        block.match(/<link[^>]*href="([^"]+)"/)?.[1] ||
        ''
      ).trim();
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '').trim();
      const source = decodeXml(
        (block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || '').trim(),
      );
      // Google titles often end with " - Source"
      let cleanTitle = title;
      let inferredSource = source;
      const dash = title.lastIndexOf(' - ');
      if (dash > 0) {
        const tail = title.slice(dash + 3).trim();
        if (!inferredSource) inferredSource = tail;
        if (!source || tail === source || tail.length <= 40) {
          cleanTitle = title.slice(0, dash).trim();
        }
      }
      if (!cleanTitle || !link) continue;
      let publishedAt: string | null = null;
      if (pubDate) {
        const d = new Date(pubDate);
        if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
      }
      items.push({
        title: cleanTitle,
        source: inferredSource || 'News',
        publishedAt,
        url: link,
      });
    }
    return { items };
  } catch (e) {
    return { items: [], error: String(e) };
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function buildTableRows(
  universe: UniverseRow[],
  maps: EtfMapRow[],
  quotes: Record<string, QuoteSnap>,
) {
  return universe.map((u) => {
    const umaps = maps.filter((m) => m.underlying === u.symbol);
    const bull = pickPrimary(umaps, 'bull');
    const bear = pickPrimary(umaps, 'bear');
    const uq = quotes[u.symbol];
    const bq = bull ? quotes[bull.etf] : undefined;
    const rq = bear ? quotes[bear.etf] : undefined;
    const updatedCandidates = [uq?.updatedAt, bq?.updatedAt, rq?.updatedAt].filter(
      Boolean,
    ) as string[];
    updatedCandidates.sort();
    return {
      underlying: u.symbol,
      name: u.name,
      sectorNote: u.sectorNote,
      bullEtf: bull?.etf ?? null,
      bullFactor: bull?.factor ?? null,
      bearEtf: bear?.etf ?? null,
      bearFactor: bear?.factor ?? null,
      bullEtfs: umaps.filter((m) => m.direction === 'bull'),
      bearEtfs: umaps.filter((m) => m.direction === 'bear'),
      underlyingLast: uq?.price ?? null,
      bullLast: bq?.price ?? null,
      bearLast: rq?.price ?? null,
      underlyingDayPct: uq?.dayPct ?? null,
      bullDayPct: bq?.dayPct ?? null,
      bearDayPct: rq?.dayPct ?? null,
      updated: updatedCandidates.length ? updatedCandidates[updatedCandidates.length - 1] : null,
    };
  });
}

export async function getResearchSummary() {
  await ensureResearchSeeded();
  const universe = await listUniverse();
  const maps = await listMaps();
  const symbols = Array.from(
    new Set([...universe.map((u) => u.symbol), ...maps.map((m) => m.etf)]),
  );
  const quotes = await getMarksMap(symbols);
  return {
    universe,
    maps,
    quotes,
    rows: buildTableRows(universe, maps, quotes),
    lastRefreshAt: lastResearchRefreshAt,
  };
}

export async function getResearchDetail(symbol: string) {
  await ensureResearchSeeded();
  const sym = symbol.toUpperCase();
  const universe = await listUniverse();
  const u = universe.find((x) => x.symbol === sym);
  if (!u) {
    return null;
  }
  const maps = await listMaps(sym);
  const bull = pickPrimary(maps, 'bull');
  const bear = pickPrimary(maps, 'bear');
  const chartSymbols = [sym, bull?.etf, bear?.etf].filter(Boolean) as string[];
  const symbols = Array.from(new Set([...chartSymbols, ...maps.map((m) => m.etf)]));
  const quotes = await getMarksMap(symbols);

  const { dates, series } = await fetchChartSeries(chartSymbols, '3mo');
  const chart = buildChartPoints(dates, series);
  const news = await fetchNewsForSymbol(sym, u.name);

  return {
    underlying: u,
    maps,
    bull,
    bear,
    quotes,
    row: buildTableRows([u], maps, quotes)[0],
    chartSymbols,
    chart,
    news: news.items,
    newsError: news.error ?? null,
    lastRefreshAt: lastResearchRefreshAt,
  };
}

export async function getResearchHandler(c: Context) {
  const data = await getResearchSummary();
  return c.json(data);
}

export async function getResearchSymbolHandler(c: Context) {
  const symbol = c.req.param('symbol') || '';
  if (!symbol) return c.json({ error: 'symbol required' }, 400);
  const data = await getResearchDetail(symbol);
  if (!data) return c.json({ error: 'Unknown research symbol' }, 404);
  return c.json(data);
}

export async function postResearchRefreshHandler(c: Context) {
  await ensureResearchSeeded();
  let remap = true;
  try {
    const body = await c.req.json().catch(() => ({}));
    if (body && body.remap === false) remap = false;
  } catch {
    // ignore
  }
  let discovered: string[] = [];
  if (remap) {
    const d = await discoverMapsForUniverse();
    discovered = d.discovered;
  }
  const quotes = await refreshResearchQuotes();
  const summary = await getResearchSummary();
  return c.json({ ...quotes, discovered, summary });
}

const SYMBOL_RE = /^[A-Za-z0-9]{1,10}$/;

export function normalizeResearchSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const sym = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(sym)) return null;
  return sym;
}

export async function addResearchUniverseSymbol(input: {
  symbol: string;
  name?: string;
  sectorNote?: string;
}): Promise<{ universe: UniverseRow[]; discovered: string[]; quotes: { updated: string[]; failed: string[] } }> {
  const symbol = normalizeResearchSymbol(input.symbol);
  if (!symbol) throw new Error('Invalid symbol: letters/digits only, 1–10 chars');

  let name = (input.name ?? '').trim();
  const sectorNote = (input.sectorNote ?? '').trim();

  if (!name) {
    try {
      const meta = await fetchYahooMeta(symbol);
      name = meta.shortName || meta.longName || symbol;
    } catch {
      name = symbol;
    }
  }

  const maxRes = await query<{ max: number | null }>(
    `SELECT MAX(sort_order) AS max FROM research_universe`,
  );
  const nextOrder = Number(maxRes.rows[0]?.max ?? 0) + 1;

  await query(
    `INSERT INTO research_universe (symbol, name, sort_order, sector_note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (symbol) DO UPDATE SET
       name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE research_universe.name END,
       sector_note = CASE
         WHEN EXCLUDED.sector_note <> '' THEN EXCLUDED.sector_note
         ELSE research_universe.sector_note
       END`,
    [symbol, name, nextOrder, sectorNote],
  );

  // Apply curated seed maps for this underlying if any
  for (const m of RESEARCH_SEED_MAPS.filter((x) => x.underlying === symbol)) {
    await query(
      `INSERT INTO research_etf_map (underlying, etf, direction, factor, source, updated_at)
       VALUES ($1, $2, $3, $4, 'seed', NOW())
       ON CONFLICT (underlying, etf) DO UPDATE SET
         direction = EXCLUDED.direction,
         factor = EXCLUDED.factor,
         source = CASE
           WHEN research_etf_map.source = 'override' THEN research_etf_map.source
           ELSE EXCLUDED.source
         END,
         updated_at = NOW()`,
      [m.underlying, m.etf, m.direction, m.factor],
    );
    await query(
      `INSERT INTO pair_cache (etf, underlying, factor, theme, source, raw_name, resolved_at)
       VALUES ($1, $2, $3, $4, 'seed', NULL, NOW())
       ON CONFLICT (etf) DO NOTHING`,
      [m.etf, m.underlying, m.factor, `${m.underlying} family`],
    );
  }

  const { discovered } = await discoverMapsForSymbol(symbol);
  const maps = await listMaps(symbol);
  const quoteSymbols = [symbol, ...maps.map((m) => m.etf)];
  const quotes = await refreshQuotesForSymbols(quoteSymbols);
  const universe = await listUniverse();
  return { universe, discovered, quotes: { updated: quotes.updated, failed: quotes.failed } };
}

export async function removeResearchUniverseSymbol(symbolRaw: string): Promise<{ universe: UniverseRow[] }> {
  const symbol = normalizeResearchSymbol(symbolRaw);
  if (!symbol) throw new Error('Invalid symbol: letters/digits only, 1–10 chars');

  await query(`DELETE FROM research_etf_map WHERE underlying = $1`, [symbol]);
  await query(`DELETE FROM research_universe WHERE symbol = $1`, [symbol]);
  const universe = await listUniverse();
  return { universe };
}

export async function reorderResearchUniverse(symbols: string[]): Promise<{ universe: UniverseRow[] }> {
  if (!Array.isArray(symbols) || !symbols.length) {
    throw new Error('symbols array required');
  }
  const normalized: string[] = [];
  for (const s of symbols) {
    const sym = normalizeResearchSymbol(s);
    if (!sym) throw new Error(`Invalid symbol: ${String(s)}`);
    if (!normalized.includes(sym)) normalized.push(sym);
  }
  for (let i = 0; i < normalized.length; i++) {
    await query(`UPDATE research_universe SET sort_order = $1 WHERE symbol = $2`, [
      i + 1,
      normalized[i],
    ]);
  }
  return { universe: await listUniverse() };
}

export async function postResearchUniverseHandler(c: Context) {
  let body: { symbol?: string; name?: string; sectorNote?: string } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'JSON body required' }, 400);
  }
  const symbol = normalizeResearchSymbol(body.symbol);
  if (!symbol) {
    return c.json({ error: 'Invalid symbol: letters/digits only, 1–10 chars' }, 400);
  }
  try {
    const result = await addResearchUniverseSymbol({
      symbol,
      name: body.name,
      sectorNote: body.sectorNote,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}

export async function deleteResearchUniverseHandler(c: Context) {
  const symbol = normalizeResearchSymbol(c.req.param('symbol') || '');
  if (!symbol) {
    return c.json({ error: 'Invalid symbol: letters/digits only, 1–10 chars' }, 400);
  }
  try {
    const result = await removeResearchUniverseSymbol(symbol);
    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}

export async function putResearchUniverseReorderHandler(c: Context) {
  let body: { symbols?: string[] } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'JSON body required' }, 400);
  }
  try {
    const result = await reorderResearchUniverse(body.symbols ?? []);
    return c.json(result);
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
}

export function startResearchRefreshCron(intervalMs = 15 * 60 * 1000): void {
  setTimeout(() => {
    void (async () => {
      await ensureResearchSeeded();
      await discoverMapsForUniverse().catch((e) =>
        console.error('research discovery failed:', e),
      );
      await refreshResearchQuotes().catch((e) =>
        console.error('research quote refresh failed:', e),
      );
    })();
  }, 8_000);

  setInterval(() => {
    void refreshResearchQuotes().catch((e) =>
      console.error('research quote refresh failed:', e),
    );
  }, intervalMs);

  console.log(`Research quote cron every ${Math.round(intervalMs / 60000)} minutes`);
}

