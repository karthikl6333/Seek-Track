/**
 * US equity session from the wall clock (America/New_York, DST handled by Intl). Exchange holidays
 * are not modelled: a holiday is treated like a normal weekday (worst case: polling unchanged prices).
 *
 * Sessions:
 *  - premarket   Mon–Fri 04:00–09:30 ET
 *  - regular     Mon–Fri 09:30–16:00 ET
 *  - afterhours  Mon–Fri 16:00–20:00 ET
 *  - closed      weekday overnight gaps (Mon–Thu 20:00 → next day 04:00)
 *  - weekend     Fri 20:00 ET → Mon 04:00 ET: NO automatic refresh at all (manual still works)
 */
export type MarketSession = 'regular' | 'premarket' | 'afterhours' | 'closed' | 'weekend';

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock weekday (0=Sun) and minutes-since-midnight in America/New_York. */
const NY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function nyClock(date: Date): { dow: number; minutes: number } {
  const parts = NY_FMT.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { dow: DOW[get('weekday')] ?? 0, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const PRE_START = 4 * 60;
const REGULAR_START = 9 * 60 + 30;
const REGULAR_END = 16 * 60;
const POST_END = 20 * 60;

export function marketSessionAt(date: Date): MarketSession {
  const { dow, minutes } = nyClock(date);
  if (dow === 6 || dow === 0) return 'weekend';
  if (dow === 5 && minutes >= POST_END) return 'weekend';
  if (dow === 1 && minutes < PRE_START) return 'weekend';
  if (minutes >= PRE_START && minutes < REGULAR_START) return 'premarket';
  if (minutes >= REGULAR_START && minutes < REGULAR_END) return 'regular';
  if (minutes >= REGULAR_END && minutes < POST_END) return 'afterhours';
  return 'closed';
}

/** Subtle label for the existing session badge while auto-refresh is paused for the weekend. */
export const WEEKEND_PRICES_LABEL = 'Weekend — prices as of Fri close';

export function isWeekendAt(date: Date): boolean {
  return marketSessionAt(date) === 'weekend';
}

/** Whether the app may trigger Yahoo refreshes automatically (manual refresh is always allowed). */
export function autoRefreshAllowedAt(date: Date): boolean {
  return !isWeekendAt(date);
}

/** Holdings + watchlist auto-refresh cadence per session; null = no automatic refresh. */
export const HOLDINGS_REFRESH_MS: Record<MarketSession, number | null> = {
  regular: 30_000,
  premarket: 60_000,
  afterhours: 60_000,
  closed: 10 * 60_000, // weekday overnight: Yahoo has few/no new prints
  weekend: null,
};

/** Full-universe (research, pairs, alerts) cadence per session; null = no automatic refresh. */
export const FULL_UNIVERSE_REFRESH_MS: Record<MarketSession, number | null> = {
  regular: 15 * 60_000,
  premarket: 15 * 60_000,
  afterhours: 15 * 60_000,
  closed: 60 * 60_000,
  weekend: null,
};

export function holdingsRefreshIntervalMs(date: Date): number | null {
  return HOLDINGS_REFRESH_MS[marketSessionAt(date)];
}

export function fullUniverseRefreshIntervalMs(date: Date): number | null {
  return FULL_UNIVERSE_REFRESH_MS[marketSessionAt(date)];
}

/**
 * Milliseconds until the weekend ends (Mon 04:00 ET), or null when not in the weekend.
 * Scans forward on minute boundaries using Intl/America/New_York, so DST shifts are handled.
 */
export function msUntilWeekendEnds(date: Date): number | null {
  if (!isWeekendAt(date)) return null;
  const MIN = 60_000;
  const start = date.getTime();
  // Coarse 15-minute steps (weekend is ≤ ~57h), then minute steps from the last weekend point.
  let t = Math.ceil(start / MIN) * MIN;
  while (isWeekendAt(new Date(t + 15 * MIN))) t += 15 * MIN;
  while (isWeekendAt(new Date(t))) t += MIN;
  return t - start;
}

export interface AutoRefreshPlan {
  session: MarketSession;
  /** Holdings/watchlist interval, null = no automatic refresh. */
  holdingsMs: number | null;
  /** Full-universe interval, null = no automatic refresh. */
  fullMs: number | null;
  /** When paused for the weekend: ms until Mon 04:00 ET, else null. */
  resumeInMs: number | null;
}

/** Everything the App scheduler needs to decide what to run at `date`. */
export function autoRefreshPlan(date: Date): AutoRefreshPlan {
  const session = marketSessionAt(date);
  return {
    session,
    holdingsMs: HOLDINGS_REFRESH_MS[session],
    fullMs: FULL_UNIVERSE_REFRESH_MS[session],
    resumeInMs: session === 'weekend' ? msUntilWeekendEnds(date) : null,
  };
}
