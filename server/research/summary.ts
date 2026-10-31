import { query } from '../db.js';
import { RESEARCH_SEED_MAPS } from './seeds.js';
import type { EtfMapRow, QuoteSnap, UniverseRow } from './types.js';
import { ensureResearchSeeded, listMaps, listUniverse } from './universe.js';
import { buildChartPoints, fetchChartSeries, fetchNewsForSymbol } from './yahoo.js';

let researchRefreshInFlight: Promise<unknown> | null = null;

let lastResearchRefreshAt: string | null = null;

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
      dayPct: r.day_pct !== null ? Number(r.day_pct) : null,
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
  const seedIndex = (etf: string) => {
    const i = RESEARCH_SEED_MAPS.findIndex(
      (m) => m.etf === etf && m.direction === direction,
    );
    return i === -1 ? 9999 : i;
  };
  // Prefer seed, then larger abs(factor), then earlier seed order (e.g. MRVU before MVLL)
  list.sort((a, b) => {
    const seedDiff = (a.source === 'seed' ? 0 : 1) - (b.source === 'seed' ? 0 : 1);
    if (seedDiff !== 0) return seedDiff;
    const absDiff = Math.abs(b.factor) - Math.abs(a.factor);
    if (absDiff !== 0) return absDiff;
    return seedIndex(a.etf) - seedIndex(b.etf);
  });
  return list[0];
}

/**
 * Research quotes now use unified quote service
 * This function delegates to the central refreshAllPrices which includes research symbols
 */
export async function refreshResearchQuotes(): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  refreshedAt: string;
}> {
  if (researchRefreshInFlight) {
    await researchRefreshInFlight;
  }

  const { forceRefresh } = await import('../quotes/quote-service.js');

  const run = (async () => {
    await ensureResearchSeeded();
    // Unified refresh automatically includes research universe + ETFs
    const result = await forceRefresh([]);
    lastResearchRefreshAt = result.refreshedAt;
    return {
      ok: result.ok,
      updated: result.updated,
      failed: result.failed,
      refreshedAt: result.refreshedAt,
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

/**
 * Refresh specific symbols using unified quote service
 */
export async function refreshQuotesForSymbols(symbols: string[]): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  refreshedAt: string;
}> {
  const { forceRefresh } = await import('../quotes/quote-service.js');
  const result = await forceRefresh(symbols);
  if (result.updated.length) lastResearchRefreshAt = result.refreshedAt;
  return {
    ok: result.ok,
    updated: result.updated,
    failed: result.failed,
    refreshedAt: result.refreshedAt,
  };
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
      underlyingPrice: uq?.price ?? null,
      bullPrice: bq?.price ?? null,
      bearPrice: rq?.price ?? null,
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
  const present = new Set(universe.map((u) => u.symbol));
  const maps = (await listMaps()).filter((m) => present.has(m.underlying));
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
