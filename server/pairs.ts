import type { Context } from 'hono';
import { query } from './db.js';
import { fetchYahooMeta } from './quotes.js';

export interface PairDef {
  etf: string;
  underlying: string;
  factor: number;
  theme: string;
  optional?: boolean;
  source?: string;
  rawName?: string | null;
}

/** Seed defaults — also used as initial cache. Not an exclusive allow-list. */
export const SEED_PAIRS: PairDef[] = [
  { etf: 'SNDQ', underlying: 'SNDK', factor: -2, theme: 'SNDK family', source: 'seed' },
  { etf: 'MULL', underlying: 'MU', factor: 2, theme: 'MU family', source: 'seed' },
  { etf: 'MUZ', underlying: 'MU', factor: -2, theme: 'MU family', source: 'seed' },
  { etf: 'AVL', underlying: 'AVGO', factor: 2, theme: 'AVGO family', source: 'seed' },
  {
    etf: 'AVS',
    underlying: 'AVGO',
    factor: -1,
    theme: 'AVGO family',
    optional: true,
    source: 'seed',
  },
  { etf: 'PLTZ', underlying: 'PLTR', factor: -2, theme: 'PLTR family', source: 'seed' },
];

const seedByEtf = new Map(SEED_PAIRS.map((p) => [p.etf, p]));
const seedByUnder = new Map<string, PairDef[]>();
for (const p of SEED_PAIRS) {
  const list = seedByUnder.get(p.underlying) ?? [];
  list.push(p);
  seedByUnder.set(p.underlying, list);
}

export async function ensureSeedPairsCached(): Promise<void> {
  for (const p of SEED_PAIRS) {
    await query(
      `INSERT INTO pair_cache (etf, underlying, factor, theme, source, raw_name, resolved_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())
       ON CONFLICT (etf) DO NOTHING`,
      [p.etf, p.underlying, p.factor, p.theme, 'seed'],
    );
  }
}

async function getCached(etf: string): Promise<PairDef | null> {
  const res = await query<{
    etf: string;
    underlying: string;
    factor: number;
    theme: string;
    source: string;
    raw_name: string | null;
  }>(`SELECT * FROM pair_cache WHERE etf = $1`, [etf.toUpperCase()]);
  const r = res.rows[0];
  if (!r) return null;
  return {
    etf: r.etf,
    underlying: r.underlying,
    factor: Number(r.factor),
    theme: r.theme,
    source: r.source,
    rawName: r.raw_name,
  };
}

async function putCache(pair: PairDef): Promise<void> {
  await query(
    `INSERT INTO pair_cache (etf, underlying, factor, theme, source, raw_name, resolved_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (etf) DO UPDATE SET
       underlying = EXCLUDED.underlying,
       factor = EXCLUDED.factor,
       theme = EXCLUDED.theme,
       source = EXCLUDED.source,
       raw_name = EXCLUDED.raw_name,
       resolved_at = NOW()`,
    [
      pair.etf.toUpperCase(),
      pair.underlying.toUpperCase(),
      pair.factor,
      pair.theme,
      pair.source ?? 'discovered',
      pair.rawName ?? null,
    ],
  );
}

/**
 * Parse leverage factor + bull/bear from ETF product name.
 * Best-effort — names vary by issuer (Direxion, T-Rex, REX, GraniteShares, etc.).
 */
export function parseLeverageFromName(name: string): {
  factor: number | null;
  bull: boolean | null;
} {
  const n = name.replace(/[–—]/g, '-');
  let factor: number | null = null;
  let bull: boolean | null = null;

  const mult =
    n.match(/(-?\d+(?:\.\d+)?)\s*[xX×]/) ||
    n.match(/(-?\d+(?:\.\d+)?)\s*-?\s*[xX]/) ||
    n.match(/\b(-?\d+(?:\.\d+)?)X\b/i);
  if (mult) factor = Number(mult[1]);

  if (/inverse|bear|short(?!\s*term)/i.test(n)) bull = false;
  else if (/long|bull/i.test(n)) bull = true;

  // "-2X" style already negative
  if (factor !== null && bull === false && factor > 0) factor = -factor;
  if (factor !== null && bull === true && factor < 0) factor = Math.abs(factor);

  return { factor, bull };
}

/** Guess underlying ticker from name tokens / common patterns. */
export function guessUnderlying(name: string, etf: string): string | null {
  const upper = name.toUpperCase();
  const etfUp = etf.toUpperCase();

  // Explicit "on TICKER" / "underlying TICKER"
  const onMatch = upper.match(
    /\b(?:ON|OF|UNDERLYING|TRACKS?|VS\.?)\s+([A-Z]{1,5})\b/,
  );
  if (onMatch && onMatch[1] !== etfUp) return onMatch[1];

  // Common product-name shapes: Long TICKER, Short TICKER, Daily TICKER Bull/Bear,
  // 2X Long TICKER, TICKER Daily — ticker must be 2–5 letters and ≠ ETF symbol.
  const shapePatterns: RegExp[] = [
    /\b(?:\d+(?:\.\d+)?\s*X\s+)?(?:LONG|SHORT)\s+([A-Z]{2,5})\b/,
    /\bDAILY\s+([A-Z]{2,5})\s+(?:BULL|BEAR|LONG|SHORT)\b/,
    /\b([A-Z]{2,5})\s+DAILY\b/,
    /\b(?:BULL|BEAR)\s+([A-Z]{2,5})\b/,
  ];
  for (const re of shapePatterns) {
    const m = upper.match(re);
    if (m && m[1] && m[1] !== etfUp) return m[1];
  }

  // Known company-name → ticker hints
  const hints: Array<[RegExp, string]> = [
    [/\bMICRON\b/, 'MU'],
    [/\bBROADCOM\b/, 'AVGO'],
    [/\bAEROVIRONMENT\b|\bAVAV\b/, 'AVAV'],
    [/\bPALANTIR\b/, 'PLTR'],
    [/\bNVIDIA\b|\bNVIDA\b/, 'NVDA'],
    [/\bTESLA\b/, 'TSLA'],
    [/\bAPPLE\b/, 'AAPL'],
    [/\bAMAZON\b/, 'AMZN'],
    [/\bMETA\b|\bFACEBOOK\b/, 'META'],
    [/\bMICROSOFT\b/, 'MSFT'],
    [/\bAMD\b|ADVANCED MICRO/, 'AMD'],
    [/\bINTEL\b/, 'INTC'],
    [/\bNETFLIX\b/, 'NFLX'],
    [/\bCOINBASE\b/, 'COIN'],
    [/\bSUPER MICRO\b|\bSMCI\b/, 'SMCI'],
    [/\bSANDISK\b|\bSNDK\b/, 'SNDK'],
    [/\bTSMC\b|\bTAIWAN SEMICONDUCTOR\b|\bTSM\b/, 'TSM'],
    [/\bASML\b/, 'ASML'],
    [/\bMARVELL\b|\bMRVL\b/, 'MRVL'],
    [/\bQUALCOMM\b|\bQCOM\b/, 'QCOM'],
    [/\bAPPLIED MATERIALS\b|\bAMAT\b/, 'AMAT'],
    [/\bLAM RESEARCH\b|\bLRCX\b/, 'LRCX'],
  ];
  for (const [re, ticker] of hints) {
    if (re.test(upper)) return ticker;
  }

  // ETF ticker ending with common leverage suffixes: NVDL → NVDA-ish — weak; skip
  return null;
}

async function discoverFromYahoo(symbol: string): Promise<PairDef | null> {
  const meta = await fetchYahooMeta(symbol);
  const name = meta.longName || meta.shortName || '';
  if (!name) return null;

  const { factor, bull } = parseLeverageFromName(name);
  const underlying = guessUnderlying(name, symbol.toUpperCase());

  // If name doesn't look leveraged and we can't find underlying, not a pair ETF
  if (factor === null && underlying === null && bull === null) {
    return null;
  }

  // If we only got an underlying guess with no factor, treat as 1x stock (not useful as pair)
  if (factor === null || !underlying) {
    // Still return partial if we have both somehow via bull default
    if (underlying && factor !== null) {
      // fall through
    } else {
      return null;
    }
  }

  const f = factor!;
  const under = underlying!;
  return {
    etf: symbol.toUpperCase(),
    underlying: under,
    factor: f,
    theme: `${under} family`,
    source: 'yahoo',
    rawName: name,
  };
}

/**
 * Resolve ETF ↔ underlying pair for a symbol (ETF or underlying).
 * Order: seed → pair_cache → Yahoo name parse → cache.
 * Discovery is best-effort; callers may override via settings.
 */
export async function resolvePair(symbol: string): Promise<{
  pair: PairDef | null;
  as: 'etf' | 'underlying' | 'unknown';
  message?: string;
}> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return { pair: null, as: 'unknown', message: 'Empty symbol' };

  await ensureSeedPairsCached();

  const seed = seedByEtf.get(sym);
  if (seed) {
    await putCache(seed);
    return { pair: { ...seed }, as: 'etf' };
  }

  const cached = await getCached(sym);
  if (cached) return { pair: cached, as: 'etf' };

  // Symbol might be an underlying — return first known ETF pair for it
  const underPairs = seedByUnder.get(sym);
  if (underPairs?.length) {
    return { pair: { ...underPairs[0] }, as: 'underlying' };
  }

  const cachedAsUnder = await query<{
    etf: string;
    underlying: string;
    factor: number;
    theme: string;
    source: string;
    raw_name: string | null;
  }>(`SELECT * FROM pair_cache WHERE underlying = $1 ORDER BY etf LIMIT 1`, [sym]);
  if (cachedAsUnder.rows[0]) {
    const r = cachedAsUnder.rows[0];
    return {
      pair: {
        etf: r.etf,
        underlying: r.underlying,
        factor: Number(r.factor),
        theme: r.theme,
        source: r.source,
        rawName: r.raw_name,
      },
      as: 'underlying',
    };
  }

  try {
    const discovered = await discoverFromYahoo(sym);
    if (discovered) {
      await putCache(discovered);
      return { pair: discovered, as: 'etf' };
    }
  } catch (e) {
    return {
      pair: null,
      as: 'unknown',
      message: `Discovery failed: ${String(e)}. You can override in Pair Map settings.`,
    };
  }

  return {
    pair: null,
    as: 'unknown',
    message:
      'Could not resolve leveraged/inverse pair for this symbol (best-effort). Override in Pair Map settings.',
  };
}

export async function listPairCache(): Promise<PairDef[]> {
  await ensureSeedPairsCached();
  const res = await query<{
    etf: string;
    underlying: string;
    factor: number;
    theme: string;
    source: string;
    raw_name: string | null;
  }>(`SELECT * FROM pair_cache ORDER BY etf`);
  return res.rows.map((r) => ({
    etf: r.etf,
    underlying: r.underlying,
    factor: Number(r.factor),
    theme: r.theme,
    source: r.source,
    rawName: r.raw_name,
  }));
}

export async function resolvePairHandler(c: Context) {
  const symbol = c.req.query('symbol') || c.req.param('symbol') || '';
  if (!symbol) return c.json({ error: 'symbol required' }, 400);
  const result = await resolvePair(symbol);
  return c.json(result);
}

export async function listPairsHandler(c: Context) {
  const pairs = await listPairCache();
  return c.json({ pairs, note: 'Seeds + discovered cache. Discovery is best-effort; override in settings.' });
}

export async function putPairOverrideHandler(c: Context) {
  const body = await c.req.json();
  if (
    !body ||
    typeof body.etf !== 'string' ||
    typeof body.underlying !== 'string' ||
    typeof body.factor !== 'number'
  ) {
    return c.json({ error: 'etf, underlying, factor required' }, 400);
  }
  const pair: PairDef = {
    etf: body.etf.toUpperCase(),
    underlying: body.underlying.toUpperCase(),
    factor: body.factor,
    theme: typeof body.theme === 'string' ? body.theme : `${body.underlying} family`,
    source: 'override',
    rawName: typeof body.rawName === 'string' ? body.rawName : null,
  };
  await putCache(pair);
  return c.json({ ok: true, pair });
}
