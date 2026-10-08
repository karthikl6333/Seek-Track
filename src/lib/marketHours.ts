/**
 * US equity session from the wall clock (America/New_York). Exchange holidays are not modelled:
 * a holiday is treated like a normal weekday (worst case: 30s/60s polling of unchanged prices).
 */
export type MarketSession = 'regular' | 'premarket' | 'afterhours' | 'closed';

export function marketSessionAt(date: Date): MarketSession {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return 'closed';
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'premarket';
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'regular';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'afterhours';
  return 'closed';
}

/** Holdings + watchlist auto-refresh cadence per session. */
export const HOLDINGS_REFRESH_MS: Record<MarketSession, number> = {
  regular: 30_000,
  premarket: 60_000,
  afterhours: 60_000,
  closed: 10 * 60_000, // Yahoo has no new prints overnight/weekends
};

/** Full-universe (research, pairs, alerts) cadence per session. */
export const FULL_UNIVERSE_REFRESH_MS: Record<MarketSession, number> = {
  regular: 15 * 60_000,
  premarket: 15 * 60_000,
  afterhours: 15 * 60_000,
  closed: 60 * 60_000,
};

export function holdingsRefreshIntervalMs(date: Date): number {
  return HOLDINGS_REFRESH_MS[marketSessionAt(date)];
}

export function fullUniverseRefreshIntervalMs(date: Date): number {
  return FULL_UNIVERSE_REFRESH_MS[marketSessionAt(date)];
}
