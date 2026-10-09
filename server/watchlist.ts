import type { Context } from 'hono';
import { query } from './db.js';
import { cached } from './isolate-cache.js';

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
  const res = await query<{ data: string | null }>(
    `SELECT data FROM settings WHERE id = 1`,
  );
  const dataStr = res.rows[0]?.data;
  let data: unknown;
  try {
    data = dataStr ? JSON.parse(dataStr) : null;
  } catch {
    data = null;
  }
  return Boolean(data && typeof data === 'object' && (data as any).watchlistSeeded === true);
}

async function setWatchlistSeededFlag(): Promise<void> {
  await query(
    `INSERT INTO settings (id, data) VALUES (1, '{"watchlistSeeded":true}')
     ON CONFLICT (id) DO UPDATE SET
       data = json_set(COALESCE(settings.data, '{}'), '$.watchlistSeeded', json('true'))`,
  );
}

/** Per isolate: once the seeded flag is confirmed, the COUNT/settings check never runs again. */
let seedVerified = false;

/** Seed once from research_universe when empty; never re-seed after user clears. */
export async function ensureWatchlistSeeded(): Promise<void> {
  if (seedVerified) return;
  await ensureWatchlistSeededUncached();
  seedVerified = true;
}

export function __resetWatchlistStateForTests(): void {
  seedVerified = false;
  lastWatchlistRefreshAt = null;
}

async function ensureWatchlistSeededUncached(): Promise<void> {
  const res = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM watchlist`);
  const count = Number(res.rows[0]?.n ?? 0);
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
         VALUES ($1, $2, $3)
         ON CONFLICT (symbol) DO NOTHING`,
        [row.symbol.toUpperCase(), row.sort_order || order, new Date().toISOString()],
      );
    }
    await setWatchlistSeededFlag();
  }
  // NEVER seed when alreadySeeded is true (even if table empty)
}

async function listWatchlistSymbols(): Promise<string[]> {
  return (await loadWatchlistRows()).symbols;
}

/** Watchlist rows cached per isolate; any write to these tables in this isolate drops it. */
export const WATCHLIST_CACHE_TTL_MS = 20_000;
const WATCHLIST_TABLES = ['watchlist', 'watchlist_quotes', 'marks', 'settings', 'research_universe'];

/**
 * ONE query: the watchlist (21 rows, sort index) LEFT JOINed to marks and watchlist_quotes by
 * primary key (one seek each per symbol). Replaces SELECT watchlist + the FULL OUTER JOIN that
 * scanned both tables (~165 rows) on every GET.
 */
function loadWatchlistRows(): Promise<{ symbols: string[]; rows: WatchlistQuoteRow[] }> {
  return cached('watchlist:rows', { ttlMs: WATCHLIST_CACHE_TTL_MS, tables: WATCHLIST_TABLES }, async () => {
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
      `SELECT
         UPPER(w.symbol) AS symbol,
         -- marks is the source of truth; fall back to the last stored watchlist quote so a row
         -- never shows blank when a marks row is missing.
         COALESCE(m.price, wq.last) AS last,
         COALESCE(m.day_pct, wq.pct_change) AS pct_change,
         wq.val_change,
         wq.bid,
         wq.ask,
         wq.market_cap,
         wq.volume,
         wq.week52_high,
         wq.week52_low,
         COALESCE(m.updated_at, wq.updated_at) AS updated_at
       FROM watchlist w
       LEFT JOIN marks m ON m.symbol = UPPER(w.symbol)
       LEFT JOIN watchlist_quotes wq ON wq.symbol = UPPER(w.symbol)
       ORDER BY w.sort_order ASC, w.symbol ASC`,
    );
    const symbols: string[] = [];
    const rows: WatchlistQuoteRow[] = [];
    const seen = new Set<string>();
    for (const r of res.rows) {
      const symbol = r.symbol.toUpperCase();
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      symbols.push(symbol);
      rows.push(toWatchlistRow(r));
    }
    return { symbols, rows };
  });
}

function toWatchlistRow(r: {
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
}): WatchlistQuoteRow {
  const updatedAt =
    r.updated_at == null ? null : typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString();
  return {
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

async function upsertWatchlistQuote(q: {
  symbol: string;
  last: number | null;
  pctChange: number | null;
  valChange: number | null;
  sessionOpen: number | null;
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
       (symbol, last, pct_change, val_change, session_open, bid, ask, market_cap, volume,
        week52_high, week52_low, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (symbol) DO UPDATE SET
       last = EXCLUDED.last,
       pct_change = EXCLUDED.pct_change,
       val_change = EXCLUDED.val_change,
       session_open = EXCLUDED.session_open,
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
      q.sessionOpen,
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
  const { symbols, rows } = await loadWatchlistRows();
  // Not cached: the in-memory refresh stamp can move without any DB write (no-change refresh).
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

    // Delegate to the unified quote service
    const { forceRefresh } = await import('./quote-service.js');
    const result = await forceRefresh(symbols);

    // Only a successful check advances the stamp (a failed refresh must not look fresh).
    if (result.ok) lastWatchlistRefreshAt = result.refreshedAt;
    return result;
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
     VALUES ($1, $2, $3)
     ON CONFLICT (symbol) DO NOTHING`,
    [symbol, nextOrder, new Date().toISOString()],
  );

  try {
    // Trigger a refresh for this single symbol using the unified refresh path
    const { forceRefresh } = await import('./quote-service.js');
    const result = await forceRefresh([symbol]);
    if (result.updated.length > 0) {
      lastWatchlistRefreshAt = result.refreshedAt;
    }
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
    
    // Prevent caching of watchlist data (always fetch latest prices)
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');
    
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
    
    // Prevent caching of refresh responses
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');
    
    // Always 200 with the payload: symbols whose refresh failed keep their last known price.
    return c.json({ ...result, ...payload }, 200);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
}
