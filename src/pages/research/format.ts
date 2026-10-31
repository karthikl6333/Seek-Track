export function fmtFactor(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}x`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Educational, generic characteristics — not personalized advice. */
export function generalCharacteristics(
  kind: 'underlying' | 'bull' | 'bear',
  factor: number | null,
): { pros: string[]; cons: string[] } {
  if (kind === 'underlying') {
    return {
      pros: ['Direct ownership exposure to the stock', 'No daily reset or leverage decay'],
      cons: ['No leverage amplification', 'Company-specific risk'],
    };
  }
  if (kind === 'bear') {
    return {
      pros: [
        'Can profit from daily declines in the underlying',
        'Hedge-style short exposure without shorting the stock',
      ],
      cons: [
        'Daily reset / compounding / volatility decay',
        'Loses when the underlying rises',
        'Path dependence; not for buy-and-hold',
        'High expense / complexity',
      ],
    };
  }
  const lev =
    factor != null && Number.isFinite(factor) ? `${Math.abs(factor)}x` : 'leveraged';
  return {
    pros: [
      `Amplified daily upside vs underlying (${lev})`,
      'Tactical short-term tool',
    ],
    cons: [
      'Daily reset / compounding / volatility decay',
      'Not for buy-and-hold',
      'Can lose even if underlying rises over multi-day periods',
      'High expense / complexity',
    ],
  };
}
