/**
 * Seasonal accent themes: a pure date → theme mapping. Only accent colors, the header glow and a small
 * ornament change. P&L gain/loss colors are never touched by a season.
 */

export type SeasonId =
  | 'winter'
  | 'spring'
  | 'summer'
  | 'autumn'
  | 'halloween'
  | 'diwali'
  | 'christmas'
  | 'holi';

/** User preference: follow the calendar, force one theme, or turn seasonal accents off. */
export type SeasonPref = 'auto' | 'off' | SeasonId;

export interface SeasonTheme {
  id: SeasonId;
  label: string;
  /** Short glyph shown as the header ornament. */
  ornament: string;
  /** Primary accent (links, active nav, primary buttons). */
  accent: string;
  /** Secondary accent (gradient end, highlights). */
  accent2: string;
  /** Text color on top of `accent` fills. */
  onAccent: string;
}

export const SEASON_THEMES: Record<SeasonId, SeasonTheme> = {
  winter: { id: 'winter', label: 'Winter', ornament: '❄', accent: '#7cc4ff', accent2: '#b8d4f0', onAccent: '#04121f' },
  spring: { id: 'spring', label: 'Spring', ornament: '✿', accent: '#b794f6', accent2: '#f0a6d0', onAccent: '#140a24' },
  summer: { id: 'summer', label: 'Summer', ornament: '☀', accent: '#29b6f6', accent2: '#ffc83d', onAccent: '#041622' },
  autumn: { id: 'autumn', label: 'Autumn', ornament: '❦', accent: '#e8a33d', accent2: '#c8643c', onAccent: '#1d1204' },
  halloween: { id: 'halloween', label: 'Halloween', ornament: '☾', accent: '#ff8a1f', accent2: '#9b6bff', onAccent: '#1c0e00' },
  diwali: { id: 'diwali', label: 'Diwali', ornament: '✦', accent: '#ffb02e', accent2: '#e0489f', onAccent: '#1c1100' },
  christmas: { id: 'christmas', label: 'Christmas / New Year', ornament: '✧', accent: '#e9c46a', accent2: '#9fd0ff', onAccent: '#1a1403' },
  holi: { id: 'holi', label: 'Holi', ornament: '❀', accent: '#ff4fa3', accent2: '#35c6e8', onAccent: '#1f0412' },
};

export const SEASON_IDS = Object.keys(SEASON_THEMES) as SeasonId[];

/** Diwali (Lakshmi Puja) and Holi (colour day) per year, New Delhi panchang: [month, day]. */
export const DIWALI_DATES: Record<number, [number, number]> = {
  2026: [11, 8],
  2027: [10, 29],
  2028: [10, 17],
  2029: [11, 5],
  2030: [10, 26],
};
export const HOLI_DATES: Record<number, [number, number]> = {
  2026: [3, 4],
  2027: [3, 23],
  2028: [3, 11],
  2029: [3, 1],
  2030: [3, 20],
};

const DAY_MS = 86_400_000;
/** Days since epoch for a civil date (timezone-free). */
const dayNum = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);

/** Whether civil date (y, m, d) is within `before`..`after` days of the festival date. */
function nearFestival(
  table: Record<number, [number, number]>,
  y: number,
  m: number,
  d: number,
  before: number,
  after: number,
): boolean {
  const today = dayNum(y, m, d);
  for (const yr of [y - 1, y, y + 1]) {
    const f = table[yr];
    if (!f) continue;
    const delta = today - dayNum(yr, f[0], f[1]);
    if (delta >= -before && delta <= after) return true;
  }
  return false;
}

/** Calendar season for the northern hemisphere: Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn. */
export function calendarSeason(month: number): SeasonId {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

/**
 * Theme id for a civil date (uses the date's local year/month/day). Holiday windows override seasons:
 * Diwali (±2 days) > Holi (±1 day) > Christmas/New Year (Dec 20–Jan 2) > Halloween (Oct 24–Nov 1).
 */
export function autoSeasonFor(date: Date): SeasonId {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (nearFestival(DIWALI_DATES, y, m, d, 2, 2)) return 'diwali';
  if (nearFestival(HOLI_DATES, y, m, d, 1, 1)) return 'holi';
  if ((m === 12 && d >= 20) || (m === 1 && d <= 2)) return 'christmas';
  if ((m === 10 && d >= 24) || (m === 11 && d <= 1)) return 'halloween';
  return calendarSeason(m);
}

/** Resolve the preference to a theme, or null when seasonal accents are off. */
export function resolveSeasonTheme(pref: SeasonPref, date: Date): SeasonTheme | null {
  if (pref === 'off') return null;
  if (pref === 'auto') return SEASON_THEMES[autoSeasonFor(date)];
  return SEASON_THEMES[pref];
}

export function isSeasonPref(v: unknown): v is SeasonPref {
  return v === 'auto' || v === 'off' || (typeof v === 'string' && Object.prototype.hasOwnProperty.call(SEASON_THEMES, v));
}

export const SEASON_PREF_STORAGE_KEY = 'seektrack.seasonTheme';

export function parseSeasonPref(raw: string | null | undefined): SeasonPref {
  return isSeasonPref(raw) ? raw : 'auto';
}

/** CSS custom properties a theme sets on :root (gain/loss are deliberately absent). */
export function seasonCssVars(theme: SeasonTheme): Record<string, string> {
  return {
    '--accent': theme.accent,
    '--accent-2': theme.accent2,
    '--on-accent': theme.onAccent,
    '--season-ornament': `"${theme.ornament}"`,
  };
}

export const SEASON_CSS_VAR_NAMES = ['--accent', '--accent-2', '--on-accent', '--season-ornament'] as const;
