import type { Context } from 'hono';
import { query } from './db.js';
import { fetchYahooChartQuote } from './quotes.js';

const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,12}$/;

export interface WatchlistQuoteRow {
  symbol: string;
  last: number | null;
  pctChange: number | null;
  valChange: number | null;
  bid: number | null;
  ask: number | null;
  marketCap: number | null;
  volume: number | null;
  week52High: number | null;
  week52Low: number | null;
  updatedAt: string | null;
}

export interface WatchlistPayload {
  symbols: string[];
  rows: WatchlistQuoteRow[];
  lastRefreshAt: string | null;
}

let lastWatchlistRefreshAt: string | null = null;
let watchlistRefreshInFlight: Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  refreshedAt: string;
}> | null = null;

export function normalizeWatchlistSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const sym = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(sym)) return null;
  return sym;
}

async function getWatchlistSeededFlag(): Promise<boolean> {
  const res = await query<{ data: Record<string, unknown> | null }>(
    `SELECT data FROM settings WHERE id = 1`,
  );
  const data = res.rows[0]?.data;
  return Boolean(data && typeof data === 'object' && data.watchlistSeeded === true);
}

async function setWatchlistSeededFlag(): Promise<void> {
  await query(
    `INSERT INTO settings (id, data) VALUES (1, '{"watchlistSeeded":true}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       data = jsonb_set(COALESCE(settings.data, '{}'::jsonb), '{watchlistSeeded}', 'true'::jsonb)`,
  );
}

/** Seed once from research_universe when empty; never re-seed after user clears. */
export async function ensureWatchlistSeeded(): Promise<void> {
  const countRes = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM watchlist`);
  const count = Number(countRes.rows[0]?.n ?? 0);
  const alreadySeeded = await getWatchlistSeededFlag();

  if (count > 0 && !alreadySeeded) {
    await setWatchlistSeededFlag();
    return;
  }

  if (!alreadySeeded && count === 0) {
    const uni = await query<{ symbol: string; sort_order: number }>(
      `SELECT symbol, sort_order FROM research_universe ORDER BY sort_order ASC, symbol ASC`,
    );
    let order = 0;
    for (const row of uni.rows) {
      order += 1;
      await query(
        `INSERT INTO watchlist (symbol, sort_order, added_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (symbol) DO NOTHING`,
        [row.symbol.toUpperCase(), row.sort_order || order],
      );
    }
    await setWatchlistSeededFlag();
  }
  // NEVER seed when alreadySeeded is true (even if table empty)
}

async function listWatchlistSymbols(): Promise<string[]> {
  const res = await query<{ symbol: string }>(
    `SELECT symbol FROM watchlist ORDER BY sort_order ASC, symbol ASC`,
  );
  return res.rows.map((r) => r.symbol.toUpperCase());
}

async function listWatchlistQuotes(symbols: string[]): Promise<Record<string, WatchlistQuoteRow>> {
  if (!symbols.length) return {};
  const res = await query<{
    symbol: string;
    last: number | null;
    pct_change: number | null;
    val_change: number | null;
    bid: number | null;
    ask: number | null;
    market_cap: number | null;
    volume: number | null;
    week52_high: number | null;
    week52_low: number | null;
    updated_at: Date | string | null;
  }>(
    `SELECT symbol, last, pct_change, val_change, bid, ask, market_cap, volume,
            week52_high, week52_low, updated_at
     FROM watchlist_quotes WHERE symbol = ANY($1)`,
    [symbols],
  );
  const out: Record<string, WatchlistQuoteRow> = {};
  for (const r of res.rows) {
    const updatedAt =
      r.updated_at == null
        ? null
        : typeof r.updated_at === 'string'
          ? r.updated_at
          : r.updated_at.toISOString();
    out[r.symbol.toUpperCase()] = {
      symbol: r.symbol.toUpperCase(),
      last: r.last != null ? Number(r.last) : null,
      pctChange: r.pct_change != null ? Number(r.pct_change) : null,
      valChange: r.val_change != null ? Number(r.val_change) : null,
      bid: r.bid != null ? Number(r.bid) : null,
      ask: r.ask != null ? Number(r.ask) : null,
      marketCap: r.market_cap != null ? Number(r.market_cap) : null,
      volume: r.volume != null ? Number(r.volume) : null,
      week52High: r.week52_high != null ? Number(r.week52_high) : null,
      week52Low: r.week52_low != null ? Number(r.week52_low) : null,
      updatedAt,
    };
  }
  return out;
}

async function upsertWatchlistQuote(q: {
  symbol: string;
  last: number | null;
  pctChange: number | null;
  valChange: number | null;
  bid: number | null;
  ask: number | null;
  marketCap: number | null;
  volume: number | null;
  week52High: number | null;
  week52Low: number | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO watchlist_quotes
       (symbol, last, pct_change, val_change, bid, ask, market_cap, volume,
        week52_high, week52_low, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (symbol) DO UPDATE SET
       last = EXCLUDED.last,
       pct_change = EXCLUDED.pct_change,
       val_change = EXCLUDED.val_change,
       bid = EXCLUDED.bid,
       ask = EXCLUDED.ask,
       market_cap = EXCLUDED.market_cap,
       volume = EXCLUDED.volume,
       week52_high = EXCLUDED.week52_high,
       week52_low = EXCLUDED.week52_low,
       updated_at = EXCLUDED.updated_at`,
    [
      q.symbol.toUpperCase(),
      q.last,
      q.pctChange,
      q.valChange,
      q.bid,
      q.ask,
      q.marketCap,
      q.volume,
      q.week52High,
      q.week52Low,
      now,
    ],
  );
}

export async function getWatchlistPayload(): Promise<WatchlistPayload> {
  await ensureWatchlistSeeded();
  const symbols = await listWatchlistSymbols();
  const quotes = await listWatchlistQuotes(symbols);
  const rows: WatchlistQuoteRow[] = symbols.map((symbol) => {
    const q = quotes[symbol];
    return (
      q ?? {
        symbol,
        last: null,
        pctChange: null,
        valChange: null,
        bid: null,
        ask: null,
        marketCap: null,
        volume: null,
        week52High: null,
        week52Low: null,
        updatedAt: null,
      }
    );
  });
  let lastRefreshAt = lastWatchlistRefreshAt;
  if (!lastRefreshAt) {
    const times = rows.map((r) => r.updatedAt).filter(Boolean) as string[];
    times.sort();
    lastRefreshAt = times.length ? times[times.length - 1] : null;
  }
  return { symbols, rows, lastRefreshAt };
}

export async function refreshWatchlistQuotes(): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  refreshedAt: string;
}> {
  if (watchlistRefreshInFlight) return watchlistRefreshInFlight;

  watchlistRefreshInFlight = (async () => {
    await ensureWatchlistSeeded();
    const symbols = await listWatchlistSymbols();
    const updated: string[] = [];
    const failed: string[] = [];

    for (const symbol of symbols) {
      try {
        const q = await fetchYahooChartQuote(symbol);
        await upsertWatchlistQuote({
          symbol,
          last: q.last,
          pctChange: q.pctChange,
          valChange: q.valChange,
          bid: q.bid,
          ask: q.ask,
          marketCap: q.marketCap,
          volume: q.volume,
          week52High: q.week52High,
          week52Low: q.week52Low,
        });
        updated.push(symbol);
        await new Promise((r) => setTimeout(r, 80));
      } catch {
        failed.push(symbol);
      }
    }

    lastWatchlistRefreshAt = new Date().toISOString();
    return {
      ok: updated.length > 0 || symbols.length === 0,
      updated,
      failed,
      refreshedAt: lastWatchlistRefreshAt,
    };
  })().finally(() => {
    watchlistRefreshInFlight = null;
  });

  return watchlistRefreshInFlight;
}

export async function addWatchlistSymbol(symbolRaw: string): Promise<WatchlistPayload> {
  const symbol = normalizeWatchlistSymbol(symbolRaw);
  if (!symbol) throw new Error('Invalid symbol: letters/digits/. /- only, 1–12 chars');

  await ensureWatchlistSeeded();
  await setWatchlistSeededFlag();

  const maxRes = await query<{ max: number | null }>(
    `SELECT MAX(sort_order) AS max FROM watchlist`,
  );
  const nextOrder = Number(maxRes.rows[0]?.max ?? 0) + 1;

  await query(
    `INSERT INTO watchlist (symbol, sort_order, added_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (symbol) DO NOTHING`,
    [symbol, nextOrder],
  );

  try {
    const q = await fetchYahooChartQuote(symbol);
    await upsertWatchlistQuote({
      symbol,
      last: q.last,
      pctChange: q.pctChange,
      valChange: q.valChange,
      bid: q.bid,
      ask: q.ask,
      marketCap: q.marketCap,
      volume: q.volume,
      week52High: q.week52High,
      week52Low: q.week52Low,
    });
    lastWatchlistRefreshAt = new Date().toISOString();
  } catch {
    // quote best-effort on add
  }

  return getWatchlistPayload();
}

export async function removeWatchlistSymbol(symbolRaw: string): Promise<WatchlistPayload> {
  const symbol = normalizeWatchlistSymbol(symbolRaw);
  if (!symbol) throw new Error('Invalid symbol: letters/digits/. /- only, 1–12 chars');

  await ensureWatchlistSeeded();
  await setWatchlistSeededFlag();
  await query(`DELETE FROM watchlist WHERE symbol = $1`, [symbol]);
  await query(`DELETE FROM watchlist_quotes WHERE symbol = $1`, [symbol]);
  return getWatchlistPayload();
}

export async function getWatchlistHandler(c: Context) {
  try {
    const data = await getWatchlistPayload();
    return c.json(data);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}

export async function postWatchlistHandler(c: Context) {
  let body: { symbol?: string } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'JSON body required' }, 400);
  }
  const symbol = normalizeWatchlistSymbol(body.symbol);
  if (!symbol) {
    return c.json({ error: 'Invalid symbol: letters/digits/. /- only, 1–12 chars' }, 400);
  }
  try {
    const data = await addWatchlistSymbol(symbol);
    return c.json(data);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}

export async function deleteWatchlistHandler(c: Context) {
  const symbol = normalizeWatchlistSymbol(c.req.param('symbol') || '');
  if (!symbol) {
    return c.json({ error: 'Invalid symbol' }, 400);
  }
  try {
    const data = await removeWatchlistSymbol(symbol);
    return c.json(data);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}

export async function postWatchlistRefreshHandler(c: Context) {
  try {
    const result = await refreshWatchlistQuotes();
    const payload = await getWatchlistPayload();
    return c.json({ ...result, ...payload }, result.ok ? 200 : 502);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}
