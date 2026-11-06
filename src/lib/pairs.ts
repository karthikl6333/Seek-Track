import type { AppSettings, PairDef, ThemeDef } from '../types/index';

/** Seed/cache defaults only — not an exclusive allow-list. Server pair_cache grows via Resolve. */
export const DEFAULT_PAIRS: PairDef[] = [
  { etf: 'SNDQ', underlying: 'SNDK', factor: -2, theme: 'SNDK family' },
  { etf: 'MULL', underlying: 'MU', factor: 2, theme: 'MU family' },
  { etf: 'MUZ', underlying: 'MU', factor: -2, theme: 'MU family' },
  { etf: 'AVL', underlying: 'AVGO', factor: 2, theme: 'AVGO family' },
  { etf: 'AVS', underlying: 'AVGO', factor: -1, theme: 'AVGO family', optional: true },
  { etf: 'PLTZ', underlying: 'PLTR', factor: -2, theme: 'PLTR family' },
];

export const DEFAULT_THEMES: ThemeDef[] = [
  { id: 'sndk', name: 'SNDK family', symbols: ['SNDK', 'SNDQ'] },
  { id: 'mu', name: 'MU family', symbols: ['MU', 'MULL', 'MUZ'] },
  { id: 'avgo', name: 'AVGO family', symbols: ['AVGO', 'AVL', 'AVS'] },
  { id: 'pltr', name: 'PLTR family', symbols: ['PLTR', 'PLTZ'] },
];

export const DEFAULT_SETTINGS: AppSettings = {
  pairs: DEFAULT_PAIRS,
  themes: DEFAULT_THEMES,
  hiddenSymbols: [],
};

export function themeForSymbol(symbol: string, themes: ThemeDef[]): string {
  const upper = symbol.toUpperCase();
  const found = themes.find((t) => t.symbols.map((s) => s.toUpperCase()).includes(upper));
  return found?.name ?? 'Other';
}

/** ETF % move → implied underlying daily move (approx). */
export function impliedUnderlyingPct(etfPct: number, factor: number): number | null {
  if (factor === 0) return null;
  return etfPct / factor;
}

/** Underlying % move → implied ETF daily move (approx). */
export function impliedEtfPct(underlyingPct: number, factor: number): number {
  return underlyingPct * factor;
}

/**
 * Expand open-position symbols with mapped underlyings from settings pairs
 * (e.g. AVL → AVGO). Holding an underlying does not pull leveraged ETFs.
 */
export function withMappedUnderlyings(
  symbols: string[],
  pairs: Array<Pick<PairDef, 'etf' | 'underlying'>>,
): string[] {
  const out = new Set<string>();
  for (const raw of symbols) {
    const sym = raw.toUpperCase().trim();
    if (!sym || sym === 'TEST') continue;
    out.add(sym);
  }
  if (out.size === 0 || pairs.length === 0) return [...out];

  const held = [...out];
  for (const sym of held) {
    for (const p of pairs) {
      const etf = p.etf.toUpperCase().trim();
      const und = p.underlying.toUpperCase().trim();
      if (etf && und && sym === etf) out.add(und);
    }
  }
  return [...out];
}
