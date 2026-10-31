import { query } from '../db.js';

/** snake_case DB row → camelCase object (shallow). */
export function toCamelCase<T>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

/** Subset of Alpaca GET /v2/account used by the refresh handlers. */
export interface AlpacaAccount {
  equity: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  long_market_value?: string;
  short_market_value?: string;
  last_equity?: string;
}

/** Subset of an Alpaca GET /v2/positions entry. */
export interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  unrealized_pl: string;
  side: string;
  asset_class?: string;
}

interface ThemeSetting {
  name?: string;
  symbols?: string[];
}

/**
 * Builds a symbol → theme-name lookup from the raw `settings.data` value.
 * D1 stores it as JSON TEXT (Postgres JSONB came back as an object); unparseable → no themes.
 */
export function buildThemeResolver(rawSettings: unknown): (symbol: string) => string {
  let settings: unknown = rawSettings;
  if (typeof rawSettings === 'string') {
    try {
      settings = JSON.parse(rawSettings);
    } catch {
      settings = null;
    }
  }
  const rawThemes = (settings as { themes?: unknown } | null | undefined)?.themes;
  const themes: ThemeSetting[] = Array.isArray(rawThemes) ? (rawThemes as ThemeSetting[]) : [];
  return (symbol: string): string => {
    const upper = symbol.toUpperCase();
    const found = themes.find(
      (t) => t.symbols && t.symbols.map((s) => s.toUpperCase()).includes(upper),
    );
    return found?.name || '';
  };
}

/** Reads app settings and returns the theme resolver used to label synced positions. */
export async function loadThemeResolver(): Promise<(symbol: string) => string> {
  const settingsRes = await query<{ data: unknown }>(`SELECT data FROM settings WHERE id = 1`);
  return buildThemeResolver(settingsRes.rows[0]?.data);
}
