/** Pure helpers for the Overview watchlist (Yahoo/Google-Finance style table). */

export interface WatchlistRowData {
  symbol: string;
  name?: string | null;
  last: number | null;
  pctChange: number | null;
  valChange: number | null;
  marketCap: number | null;
  volume: number | null;
  week52High: number | null;
  week52Low: number | null;
}

export type WatchlistSortKey =
  | 'symbol'
  | 'last'
  | 'valChange'
  | 'pctChange'
  | 'range'
  | 'week52High'
  | 'week52Low'
  | 'marketCap'
  | 'volume';

const DASH = '—';
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** 1.23T / 45.6B / 789M (3 significant figures); below 1M falls back to a grouped integer. */
export function fmtMarketCap(n: number | null | undefined): string {
  if (!isNum(n) || n <= 0) return DASH;
  if (n < 1e6) return Math.round(n).toLocaleString('en-US');
  const units: Array<[number, string]> = [
    [1e6, 'M'],
    [1e9, 'B'],
    [1e12, 'T'],
  ];
  let i = n >= 1e12 ? 2 : n >= 1e9 ? 1 : 0;
  let s = sig3(n / units[i][0]);
  // 999.6M rounds to "1000" -> promote to the next unit ("1.00B") instead of showing 4 digits.
  if (Number(s) >= 1000 && i < 2) {
    i += 1;
    s = sig3(n / units[i][0]);
  }
  return `${s}${units[i][1]}`;
}

function sig3(v: number): string {
  const p = v.toPrecision(3);
  return p.includes('e') ? String(Math.round(Number(p))) : p;
}

/** Volume: 36.4M / 1.23B / 812K. */
export function fmtVolume(n: number | null | undefined): string {
  if (!isNum(n) || n < 0) return DASH;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return Math.round(n).toLocaleString('en-US');
}

/** Signed change with an explicit +, no currency sign (the column header carries the unit). */
export function fmtSigned(n: number | null | undefined, digits = 2, suffix = ''): string {
  if (!isNum(n)) return DASH;
  const fixed = Math.abs(n).toFixed(digits);
  // Avoid "-0.00" / "+0.00" noise: a rounded-to-zero move is shown unsigned.
  if (Number(fixed) === 0) return `${fixed}${suffix}`;
  return `${n < 0 ? '-' : '+'}${fixed}${suffix}`;
}

/** Plain price without a currency sign for the dense table; dash when unknown. */
export function fmtPrice(n: number | null | undefined): string {
  if (!isNum(n)) return DASH;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Where the last price sits in its 52-week range, 0 (at the low) .. 1 (at the high).
 * Null when any input is missing or the range is degenerate. Clamped: a price outside the stored
 * range (stale 52w data) pins to the nearer end instead of drawing outside the bar.
 */
export function rangePosition(
  last: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined,
): number | null {
  if (!isNum(last) || !isNum(low) || !isNum(high) || high <= low) return null;
  return Math.min(1, Math.max(0, (last - low) / (high - low)));
}

function sortValue(row: WatchlistRowData, key: WatchlistSortKey): number | string | null {
  if (key === 'range') return rangePosition(row.last, row.week52Low, row.week52High);
  if (key === 'symbol') return row.symbol;
  return row[key];
}

/** Nulls always sort last regardless of direction. Stable on ties (falls back to symbol). */
export function sortWatchlistRows<T extends WatchlistRowData>(rows: T[], key: WatchlistSortKey, dir: 1 | -1): T[] {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    const aNull = av === null || av === undefined || av === '';
    const bNull = bv === null || bv === undefined || bv === '';
    if (aNull && bNull) return a.symbol.localeCompare(b.symbol);
    if (aNull) return 1;
    if (bNull) return -1;
    const c =
      typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) * dir : (Number(av) - Number(bv)) * dir;
    return c !== 0 ? c : a.symbol.localeCompare(b.symbol);
  });
}

/**
 * Day change in dollars, on the SAME basis as the day % (vs the previous regular close).
 * The stored `val_change` is last minus the session OPEN, so beside a previous-close based % it can
 * disagree (e.g. +$20.90 next to -4.82%). Derive it from last and the day % instead; fall back to the
 * stored value only when there is no usable %.
 */
export function dayChangeAmount(last: number | null, pct: number | null, stored: number | null): number | null {
  if (last !== null && Number.isFinite(last) && pct !== null && Number.isFinite(pct) && pct > -100) {
    return last - last / (1 + pct / 100);
  }
  return stored;
}
