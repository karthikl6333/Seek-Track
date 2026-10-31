import { query } from '../db.js';
import { fetchYahooMeta } from '../quotes/quotes.js';
import type { UniverseRow } from './types.js';
import { RESEARCH_SEED_MAPS } from './seeds.js';
import { listMaps, listUniverse, setResearchUniverseSeededFlag } from './universe.js';
import { discoverMapsForSymbol } from './discovery.js';
import { refreshQuotesForSymbols } from './summary.js';

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

  // Re-adding clears the exclusion tombstone so the symbol can return
  await query(`DELETE FROM research_universe_excluded WHERE symbol = $1`, [symbol]);

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

  await query(
    `INSERT INTO research_universe_excluded (symbol, removed_at)
     VALUES ($1, NOW())
     ON CONFLICT (symbol) DO UPDATE SET removed_at = NOW()`,
    [symbol],
  );
  await query(`DELETE FROM research_etf_map WHERE underlying = $1`, [symbol]);
  await query(`DELETE FROM research_universe WHERE symbol = $1`, [symbol]);
  await setResearchUniverseSeededFlag();
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
