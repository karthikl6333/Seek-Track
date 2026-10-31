import { query } from '../db.js';
import { fetchYahooMeta } from '../quotes/quotes.js';
import { parseLeverageFromName, guessUnderlying } from '../quotes/pairs.js';
import { RESEARCH_SEED_MAPS } from './seeds.js';
import { listMaps, listUniverse } from './universe.js';
import { USER_AGENT } from './yahoo.js';

/** Extra candidates to probe via Yahoo name heuristics (discovery). */
const DISCOVERY_CANDIDATES: Record<string, string[]> = {
  NVDA: ['NVDU', 'NVDD', 'NVDQ'],
  AVGO: [],
  TSM: ['TSMU', 'TSMG'],
  ASML: [],
  AMD: ['AMUU', 'AMDD'],
  MU: ['MUU', 'MUD'],
  INTC: [],
  QCOM: ['QCMU', 'QCMD'],
  AMAT: ['AMAU'],
  LRCX: [],
  SNDK: ['SNXX', 'SNDQ'],
  MRVL: ['MRVU', 'MVLL'],
};

/** Company-name → whole-word tokens that may appear in ETF product names. */
const UNDERLYING_COMPANY_WORDS: Record<string, string[]> = {
  AVGO: ['BROADCOM'],
  MU: ['MICRON'],
  NVDA: ['NVIDIA', 'NVIDA'],
  PLTR: ['PALANTIR'],
  TSLA: ['TESLA'],
  AAPL: ['APPLE'],
  AMZN: ['AMAZON'],
  META: ['META', 'FACEBOOK'],
  MSFT: ['MICROSOFT'],
  AMD: ['AMD'],
  INTC: ['INTEL'],
  NFLX: ['NETFLIX'],
  COIN: ['COINBASE'],
  SMCI: ['SUPER MICRO', 'SMCI'],
  SNDK: ['SANDISK', 'SNDK'],
  TSM: ['TSMC', 'TAIWAN SEMICONDUCTOR', 'TSM'],
  ASML: ['ASML'],
  MRVL: ['MARVELL', 'MRVL'],
  QCOM: ['QUALCOMM', 'QCOM'],
  AMAT: ['APPLIED MATERIALS', 'AMAT'],
  LRCX: ['LAM RESEARCH', 'LRCX'],
  AVAV: ['AEROVIRONMENT', 'AVAV'],
};

/**
 * Strict name↔underlying check: whole-token ticker match and/or known company words.
 * Rejects substring false-positives (e.g. AVXX name "…AVAV…" must not match AVGO via "AV").
 */
export function nameMentionsUnderlying(
  name: string,
  underlying: string,
  companyName?: string,
): boolean {
  const nameUp = name.toUpperCase();
  const under = underlying.toUpperCase();
  if (!under || !nameUp) return false;

  // Whole-token / word-boundary ticker match (NOT substring)
  const tickerRe = new RegExp(`\\b${under.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  if (tickerRe.test(nameUp)) return true;

  const known = UNDERLYING_COMPANY_WORDS[under] ?? [];
  for (const word of known) {
    const w = word.toUpperCase();
    if (w.includes(' ')) {
      if (nameUp.includes(w)) return true;
    } else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(nameUp)) {
      return true;
    }
  }

  // Optional company display name — only whole words of length >= 4 (never 2–3 letter prefixes)
  if (companyName) {
    const tokens = companyName
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 4);
    for (const t of tokens) {
      if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(nameUp)) {
        return true;
      }
    }
  }
  return false;
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

/**
 * Re-fetch Yahoo names for mapped ETFs and DELETE rows whose name no longer
 * strictly matches the claimed underlying. Used on remap so stale yahoo
 * mis-maps (e.g. AVXX→AVGO) get purged even when discovery would skip known ETFs.
 */
export async function revalidateYahooMaps(underlying?: string): Promise<{
  deleted: string[];
  checked: number;
}> {
  const deleted: string[] = [];
  const params: string[] = [];
  let sql = `SELECT underlying, etf, source FROM research_etf_map WHERE source = 'yahoo'`;
  if (underlying) {
    sql += ` AND underlying = $1`;
    params.push(underlying.toUpperCase());
  }
  sql += ` ORDER BY underlying, etf`;
  const res = await query<{ underlying: string; etf: string; source: string }>(sql, params);

  // Also scrub known bad AVXX→AVGO immediately (even if source flipped somehow)
  if (!underlying || underlying.toUpperCase() === 'AVGO') {
    const scrub = await query<{ etf: string }>(
      `DELETE FROM research_etf_map WHERE underlying = 'AVGO' AND etf = 'AVXX' RETURNING etf`,
    );
    if (scrub.rows.length) deleted.push('AVXX->AVGO(scrub)');
  }

  for (const row of res.rows) {
    const etf = row.etf.toUpperCase();
    const under = row.underlying.toUpperCase();
    try {
      const meta = await fetchYahooMeta(etf);
      const name = meta.longName || meta.shortName || '';
      if (!name) {
        await query(`DELETE FROM research_etf_map WHERE underlying = $1 AND etf = $2`, [
          under,
          etf,
        ]);
        deleted.push(`${etf}->${under}(no-name)`);
        await new Promise((r) => setTimeout(r, 80));
        continue;
      }
      const guessed = guessUnderlying(name, etf);
      const ok =
        nameMentionsUnderlying(name, under) &&
        (!guessed || guessed === under);
      if (!ok) {
        await query(`DELETE FROM research_etf_map WHERE underlying = $1 AND etf = $2`, [
          under,
          etf,
        ]);
        deleted.push(`${etf}->${under}`);
        // Drop pair_cache yahoo entry for this etf if it claimed same under
        await query(
          `DELETE FROM pair_cache WHERE etf = $1 AND underlying = $2 AND source = 'yahoo'`,
          [etf, under],
        );
      }
      await new Promise((r) => setTimeout(r, 80));
    } catch {
      // If Yahoo fails, leave the row (transient); do not delete on network blip
    }
  }
  return { deleted, checked: res.rows.length };
}

/** Probe candidate tickers and Yahoo search for one underlying. */
export async function discoverMapsForSymbol(symbol: string): Promise<{ discovered: string[] }> {
  const discovered: string[] = [];
  const sym = symbol.toUpperCase();
  // Purge stale yahoo mis-maps for this underlying before probing (skips known ETFs otherwise)
  const purged = await revalidateYahooMaps(sym);
  for (const d of purged.deleted) discovered.push(`deleted:${d}`);
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
    `${u.symbol}V`,
  ];
  // Tradr / Direxion-style shortenings (e.g. SNDK → SNXX; MRVL → MRVU / MVLL)
  if (u.symbol.length >= 4) {
    const stem3 = u.symbol.slice(0, 3);
    const stem2 = u.symbol.slice(0, 2);
    patterns.push(
      `${stem3}Q`,
      `${stem3}X`,
      `${stem3}L`,
      `${stem3}S`,
      `${stem3}U`,
      `${stem3}V`,
      `${stem3}D`,
    );
    patterns.push(
      `${stem2}XX`,
      `${stem2}XQ`,
      `${stem2}XL`,
      `${stem2}VU`,
      `${stem2}VL`,
      `${stem2}LL`,
      `${stem2}UU`,
      `${stem2}DD`,
    );
  }

  const toTry = Array.from(new Set([...candidates, ...patterns])).filter(
    (t) =>
      t !== u.symbol &&
      !t.includes('-') &&
      !t.includes('.') &&
      !existing.some((m) => m.etf === t),
  );

  for (const cand of toTry) {
    try {
      const meta = await fetchYahooMeta(cand);
      const name = meta.longName || meta.shortName || '';
      if (!name) continue;
      let { factor, bull } = parseLeverageFromName(name);
      const nameUp = name.toUpperCase();
      const guessed = guessUnderlying(name, cand);
      // If guess points at a different ticker, never map to this underlying (e.g. AVXX→AVAV ≠ AVGO)
      if (guessed && guessed !== u.symbol) continue;
      let under: string | null = guessed;
      if (!under && nameMentionsUnderlying(name, u.symbol, u.name)) under = u.symbol;
      // Never default under to u.symbol unless name explicitly mentions ticker/company
      if (!under || under !== u.symbol) continue;
      if (!nameMentionsUnderlying(name, u.symbol, u.name)) continue;
      // Weak-parse fallback: name mentions under + leverage/daily ETF cues
      if ((factor === null || bull === null) && looksLikeLeveragedEtfName(nameUp)) {
        const inferred = inferLeverageFromWeakName(nameUp);
        if (inferred) {
          factor = inferred.factor;
          bull = inferred.bull;
        }
      }
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

  const fromSearch = await deepDiscoverFromSearchQueries(u);
  discovered.push(...fromSearch);

  return { discovered };
}

function looksLikeLeveragedEtfName(nameUp: string): boolean {
  return (
    /\b2X\b|\b2\s*X\b|\b3X\b|\bBULL\b|\bBEAR\b|\bLONG\b|\bSHORT\b|\bDAILY\b.*\bETF\b|\bETF\b.*\bDAILY\b/.test(
      nameUp,
    )
  );
}

function inferLeverageFromWeakName(
  nameUp: string,
): { factor: number; bull: boolean } | null {
  const bullish = /\bBULL\b|\bLONG\b/.test(nameUp);
  const bearish = /\bBEAR\b|\bSHORT\b|\bINVERSE\b/.test(nameUp);
  if (!bullish && !bearish) return null;
  const mult = nameUp.match(/\b(-?\d+(?:\.\d+)?)\s*X\b/);
  let factor = mult ? Math.abs(Number(mult[1])) : 2;
  if (!Number.isFinite(factor) || factor === 0) factor = 2;
  if (bearish) factor = -Math.abs(factor);
  return { factor: Math.abs(factor), bull: bullish && !bearish };
}

/**
 * Yahoo finance search pass — broader issuer/company queries.
 * Prefer quoteType ETF; skip hyphen/dot symbols; accept weak name parses
 * when the name clearly references the underlying + leverage cues.
 */
async function deepDiscoverFromSearchQueries(u: {
  symbol: string;
  name: string;
}): Promise<string[]> {
  const discovered: string[] = [];
  const companyFirst = u.name.split(/[\s,]+/)[0] || u.name;
  const searchQueries = [
    `2x ${u.symbol}`,
    `2x Long ${u.symbol}`,
    `2x Short ${u.symbol}`,
    `-2x ${u.symbol}`,
    `Long ${u.symbol} Daily ETF`,
    `Short ${u.symbol} Daily ETF`,
    `2X Long ${u.symbol} Daily ETF`,
    `Tradr ${u.symbol}`,
    `Direxion ${u.symbol}`,
    `Direxion Daily ${u.symbol}`,
    `GraniteShares 2x ${u.symbol}`,
    `${u.symbol} Bull 2X ETF`,
    `${u.symbol} Bear ETF`,
    `${u.name} 2x ETF`,
    `${companyFirst} leveraged ETF`,
  ];
  const known = await listMaps(u.symbol);
  for (const queryText of searchQueries) {
    try {
      const q = encodeURIComponent(queryText);
      const res = await fetch(
        `https://query2.finance.yahoo.com/v1/finance/search?q=${q}&quotesCount=16&newsCount=0`,
        { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as {
        quotes?: Array<{
          symbol?: string;
          shortname?: string;
          longname?: string;
          quoteType?: string;
        }>;
      };
      const quotes = [...(data.quotes ?? [])].sort((a, b) => {
        const ae = (a.quoteType || '').toUpperCase() === 'ETF' ? 0 : 1;
        const be = (b.quoteType || '').toUpperCase() === 'ETF' ? 0 : 1;
        return ae - be;
      });
      for (const quote of quotes) {
        const etfSym = (quote.symbol || '').toUpperCase();
        // Skip Yahoo currency / composite suffixes (SNXX-USD, etc.)
        if (!etfSym || etfSym === u.symbol || etfSym.includes('.') || etfSym.includes('-'))
          continue;
        if (known.some((m) => m.etf === etfSym)) continue;
        const quoteType = (quote.quoteType || '').toUpperCase();
        // Prefer ETFs; still allow EQUITY/ETC when name looks leveraged
        const name = quote.longname || quote.shortname || '';
        const nameUp = name.toUpperCase();
        if (quoteType && quoteType !== 'ETF' && !looksLikeLeveragedEtfName(nameUp)) continue;
        let { factor, bull } = parseLeverageFromName(name);
        const guessed = guessUnderlying(name, etfSym);
        if (guessed && guessed !== u.symbol) continue;
        let under: string | null = guessed;
        if (!under && nameMentionsUnderlying(name, u.symbol, u.name)) under = u.symbol;
        if (!under || under !== u.symbol) continue;
        if (!nameMentionsUnderlying(name, u.symbol, u.name)) continue;
        if ((factor === null || bull === null) && looksLikeLeveragedEtfName(nameUp)) {
          const inferred = inferLeverageFromWeakName(nameUp);
          if (inferred) {
            factor = inferred.factor;
            bull = inferred.bull;
          }
        }
        if (factor === null || bull === null) continue;
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
  return discovered;
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
