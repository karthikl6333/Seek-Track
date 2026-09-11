export function fmtMoney(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  // If value is between 0 and 1 (e.g., 0.52 meaning 52%), multiply by 100
  const val = n > 0 && n < 1 ? n * 100 : n;
  return `${val.toFixed(digits)}%`;
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
