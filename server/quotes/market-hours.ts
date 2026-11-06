/**
 * US equity session from the wall clock (America/New_York; DST handled by Intl) plus the NYSE
 * full-day holiday calendar, computed by rule so it works for any year.
 *
 * Sessions on a trading day:
 *  - premarket   04:00–09:30 ET
 *  - regular     09:30–16:00 ET
 *  - afterhours  16:00–20:00 ET
 *  - closed      overnight between two consecutive trading days (20:00 → next day 04:00)
 * And:
 *  - nontrading  from 20:00 ET on the last trading day before a weekend and/or holiday until 04:00 ET
 *                on the next trading day (e.g. Fri 20:00 → Mon 04:00; holiday Monday: Fri 20:00 →
 *                Tue 04:00; Thanksgiving: Wed 20:00 → Fri 04:00; Good Friday: Thu 20:00 → Mon 04:00).
 *                NO automatic refresh at all (manual refresh still works).
 *
 * Early-close days (day after Thanksgiving, Christmas Eve, Jul 3) are treated as normal trading days.
 */
export type MarketSession = 'regular' | 'premarket' | 'afterhours' | 'closed' | 'nontrading';

/** A civil (calendar) date in New York. month is 1-12. */
export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PRE_START = 4 * 60;
const REGULAR_START = 9 * 60 + 30;
const REGULAR_END = 16 * 60;
const POST_END = 20 * 60;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Civil-date helpers (pure calendar arithmetic, no time zone involved)
// ---------------------------------------------------------------------------------------------

const toUtcDay = (c: CivilDate) => Date.UTC(c.y, c.m - 1, c.d);
const fromUtcDay = (ms: number): CivilDate => {
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};
export const addDays = (c: CivilDate, n: number): CivilDate => fromUtcDay(toUtcDay(c) + n * DAY_MS);
export const dayOfWeek = (c: CivilDate): number => new Date(toUtcDay(c)).getUTCDay();
export const civilKey = (c: CivilDate): string =>
  `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;

/** n-th (1-based) given weekday of a month; n = -1 means the last one. */
function nthWeekday(y: number, m: number, weekday: number, n: number): CivilDate {
  if (n > 0) {
    const first = { y, m, d: 1 };
    const offset = (weekday - dayOfWeek(first) + 7) % 7;
    return { y, m, d: 1 + offset + (n - 1) * 7 };
  }
  const last = fromUtcDay(Date.UTC(y, m, 0)); // day 0 of next month = last day of m
  const back = (dayOfWeek(last) - weekday + 7) % 7;
  return addDays(last, -back);
}

/** Gregorian Easter Sunday (Anonymous / Meeus–Jones–Butcher computus). */
export function easterSunday(y: number): CivilDate {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return { y, m: month, d: day };
}

/** Saturday → Friday before, Sunday → Monday after (standard NYSE observance). */
function observed(c: CivilDate): CivilDate {
  const dow = dayOfWeek(c);
  if (dow === 6) return addDays(c, -1);
  if (dow === 0) return addDays(c, 1);
  return c;
}

export interface Holiday {
  date: CivilDate;
  name: string;
}

const holidayCache = new Map<number, Holiday[]>();

/** NYSE full-day closures for year `y`, in date order. */
export function nyseHolidays(y: number): Holiday[] {
  const cached = holidayCache.get(y);
  if (cached) return cached;
  const list: Holiday[] = [];

  // New Year's Day: Sunday → Monday Jan 2. Saturday → NOT observed (NYSE Rule 7.2: no closing on
  // the Friday before, which would be Dec 31 of the prior year).
  const ny = { y, m: 1, d: 1 };
  if (dayOfWeek(ny) !== 6) list.push({ date: observed(ny), name: "New Year's Day" });
  if (y >= 1998) list.push({ date: nthWeekday(y, 1, 1, 3), name: 'Martin Luther King, Jr. Day' });
  list.push({ date: nthWeekday(y, 2, 1, 3), name: "Washington's Birthday" });
  list.push({ date: addDays(easterSunday(y), -2), name: 'Good Friday' });
  list.push({ date: nthWeekday(y, 5, 1, -1), name: 'Memorial Day' });
  if (y >= 2022) list.push({ date: observed({ y, m: 6, d: 19 }), name: 'Juneteenth' });
  list.push({ date: observed({ y, m: 7, d: 4 }), name: 'Independence Day' });
  list.push({ date: nthWeekday(y, 9, 1, 1), name: 'Labor Day' });
  list.push({ date: nthWeekday(y, 11, 4, 4), name: 'Thanksgiving Day' });
  list.push({ date: observed({ y, m: 12, d: 25 }), name: 'Christmas Day' });

  list.sort((a, b) => toUtcDay(a.date) - toUtcDay(b.date));
  holidayCache.set(y, list);
  return list;
}

export function holidayOn(c: CivilDate): Holiday | null {
  const key = civilKey(c);
  return nyseHolidays(c.y).find((h) => civilKey(h.date) === key) ?? null;
}

export function isTradingDay(c: CivilDate): boolean {
  const dow = dayOfWeek(c);
  return dow !== 0 && dow !== 6 && !holidayOn(c);
}

// ---------------------------------------------------------------------------------------------
// Wall clock in New York
// ---------------------------------------------------------------------------------------------

const NY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Wall-clock date, weekday (0=Sun) and minutes-since-midnight in America/New_York. */
export function nyClock(date: Date): { date: CivilDate; dow: number; minutes: number } {
  const p = Object.fromEntries(NY_FMT.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    date: { y: Number(p.year), m: Number(p.month), d: Number(p.day) },
    dow: DOW[p.weekday] ?? 0,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** The instant at which New York wall clock reads `c` at hh:mm (DST resolved through Intl). */
export function nyWallTimeToDate(c: CivilDate, hh: number, mm: number): Date {
  const wanted = Date.UTC(c.y, c.m - 1, c.d, hh, mm);
  for (const offH of [5, 4, 6, 3]) {
    const cand = new Date(wanted + offH * 3_600_000);
    const k = nyClock(cand);
    if (toUtcDay(k.date) + k.minutes * 60_000 === wanted) return cand;
  }
  throw new Error(`No America/New_York instant for ${civilKey(c)} ${hh}:${mm}`);
}

// ---------------------------------------------------------------------------------------------
// Sessions and the non-trading window
// ---------------------------------------------------------------------------------------------

export function marketSessionAt(date: Date): MarketSession {
  const { date: today, minutes } = nyClock(date);
  if (!isTradingDay(today)) return 'nontrading';
  if (minutes < PRE_START) return isTradingDay(addDays(today, -1)) ? 'closed' : 'nontrading';
  if (minutes >= POST_END) return isTradingDay(addDays(today, 1)) ? 'closed' : 'nontrading';
  if (minutes < REGULAR_START) return 'premarket';
  if (minutes < REGULAR_END) return 'regular';
  return 'afterhours';
}

export interface NonTradingWindow {
  /** 'holiday' when any day in the window is an NYSE holiday, else 'weekend'. */
  kind: 'weekend' | 'holiday';
  holidays: Holiday[];
  /** Last trading day before the window (prices shown are its close / after-hours). */
  lastTradingDay: CivilDate;
  /** Next trading day; automatic refresh resumes at its 04:00 ET. */
  resumeDay: CivilDate;
  resumesAt: Date;
}

/** Details of the non-trading window containing `date`, or null when not in one. */
export function nonTradingWindowAt(date: Date): NonTradingWindow | null {
  if (marketSessionAt(date) !== 'nontrading') return null;
  const { date: today, minutes } = nyClock(date);
  // Trading day before 04:00 → resumes today; trading day after 20:00 → scan from tomorrow;
  // non-trading day → scan from today.
  let resumeDay: CivilDate;
  if (isTradingDay(today) && minutes < PRE_START) {
    resumeDay = today;
  } else {
    resumeDay = isTradingDay(today) ? addDays(today, 1) : today;
    for (let i = 0; i < 31 && !isTradingDay(resumeDay); i++) resumeDay = addDays(resumeDay, 1);
  }
  const closedDays: CivilDate[] = [];
  let lastTradingDay = addDays(resumeDay, -1);
  for (let i = 0; i < 31 && !isTradingDay(lastTradingDay); i++) {
    closedDays.unshift(lastTradingDay);
    lastTradingDay = addDays(lastTradingDay, -1);
  }
  const holidays = closedDays.map(holidayOn).filter((h): h is Holiday => h !== null);
  return {
    kind: holidays.length > 0 ? 'holiday' : 'weekend',
    holidays,
    lastTradingDay,
    resumeDay,
    resumesAt: nyWallTimeToDate(resumeDay, 4, 0),
  };
}

export function isNonTradingAt(date: Date): boolean {
  return marketSessionAt(date) === 'nontrading';
}

/** Whether the app may trigger Yahoo refreshes automatically (manual refresh is always allowed). */
export function autoRefreshAllowedAt(date: Date): boolean {
  return !isNonTradingAt(date);
}

/** Milliseconds until automatic refresh resumes (next trading day 04:00 ET), or null if not paused. */
export function msUntilTradingResumes(date: Date): number | null {
  const w = nonTradingWindowAt(date);
  return w ? Math.max(0, w.resumesAt.getTime() - date.getTime()) : null;
}

const fmtCivil = (c: CivilDate) => `${DOW_SHORT[dayOfWeek(c)]} ${MONTH_SHORT[c.m - 1]} ${c.d}`;

/** Short badge text: 'Weekend' or 'Holiday'. */
export function nonTradingBadge(w: NonTradingWindow): string {
  return w.kind === 'holiday' ? 'Holiday' : 'Weekend';
}

/** Tooltip, e.g. "Holiday (Thanksgiving Day): automatic refresh paused until Fri Nov 27, 04:00 ET. Manual refresh still works." */
export function nonTradingTooltip(w: NonTradingWindow): string {
  const what = w.kind === 'holiday' ? `Holiday (${w.holidays.map((h) => h.name).join(', ')})` : 'Weekend';
  return `${what}: automatic refresh paused until ${fmtCivil(w.resumeDay)}, 04:00 ET. Manual refresh still works.`;
}

/** Subtle session-badge label, e.g. "Weekend — prices as of Fri close". */
export function nonTradingPricesLabel(w: NonTradingWindow): string {
  return `${nonTradingBadge(w)} — prices as of ${DOW_SHORT[dayOfWeek(w.lastTradingDay)]} close`;
}

// ---------------------------------------------------------------------------------------------
// Refresh cadence
// ---------------------------------------------------------------------------------------------

/** Holdings + watchlist auto-refresh cadence per session; null = no automatic refresh. */
export const HOLDINGS_REFRESH_MS: Record<MarketSession, number | null> = {
  regular: 30_000,
  premarket: 60_000,
  afterhours: 60_000,
  closed: 10 * 60_000, // overnight between trading days: few/no new prints
  nontrading: null,
};

/** Full-universe (research, pairs, alerts) cadence per session; null = no automatic refresh. */
export const FULL_UNIVERSE_REFRESH_MS: Record<MarketSession, number | null> = {
  regular: 15 * 60_000,
  premarket: 15 * 60_000,
  afterhours: 15 * 60_000,
  closed: 60 * 60_000,
  nontrading: null,
};

export function holdingsRefreshIntervalMs(date: Date): number | null {
  return HOLDINGS_REFRESH_MS[marketSessionAt(date)];
}

export function fullUniverseRefreshIntervalMs(date: Date): number | null {
  return FULL_UNIVERSE_REFRESH_MS[marketSessionAt(date)];
}

export interface AutoRefreshPlan {
  session: MarketSession;
  /** Holdings/watchlist interval, null = no automatic refresh. */
  holdingsMs: number | null;
  /** Full-universe interval, null = no automatic refresh. */
  fullMs: number | null;
  /** When paused (weekend/holiday): ms until next trading day 04:00 ET, else null. */
  resumeInMs: number | null;
  /** The weekend/holiday window when paused, else null. */
  window: NonTradingWindow | null;
}

/** Everything the App scheduler needs to decide what to run at `date`. */
export function autoRefreshPlan(date: Date): AutoRefreshPlan {
  const session = marketSessionAt(date);
  const window = session === 'nontrading' ? nonTradingWindowAt(date) : null;
  return {
    session,
    holdingsMs: HOLDINGS_REFRESH_MS[session],
    fullMs: FULL_UNIVERSE_REFRESH_MS[session],
    resumeInMs: window ? Math.max(0, window.resumesAt.getTime() - date.getTime()) : null,
    window,
  };
}
