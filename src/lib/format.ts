export function fmtMoney(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/**
 * Format a value that is ALREADY in percent units (1.13 -> "1.13%", 0.89 -> "0.89%").
 * Do not pass fractions here; use fmtRatioPct for 0..1 ratios such as win rate.
 * (A previous "auto-scale values between 0 and 1" heuristic turned a +0.89% day move into
 * "89.38%".)
 */
export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

/** Format a 0..1 ratio as a percentage (0.52 -> "52.00%", 1 -> "100.00%"). */
export function fmtRatioPct(r: number | null | undefined, digits = 2): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—';
  return fmtPct(r * 100, digits);
}

export function fmtQty(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** P&L tone: mono + pos/neg pill classes when non-zero. */
export function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n) || n === 0) return 'mono';
  return n > 0 ? 'mono pos' : 'mono neg';
}

/** Highlight helpers for important money cells (fees, notional, stats). */
export function moneyTone(kind: 'fee' | 'notional' | 'stat'): string {
  return `mono hl-${kind}`;
}

/** Fee highlight when fee is non-zero. */
export function feeClass(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n) || n === 0) return 'mono';
  return 'mono hl-fee';
}
