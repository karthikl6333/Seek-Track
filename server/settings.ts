import type { Context } from 'hono';
import { query } from './db.js';

const DEFAULT_SETTINGS = {
  pairs: [
    { etf: 'SNDQ', underlying: 'SNDK', factor: -2, theme: 'SNDK family' },
    { etf: 'MULL', underlying: 'MU', factor: 2, theme: 'MU family' },
    { etf: 'MUZ', underlying: 'MU', factor: -2, theme: 'MU family' },
    { etf: 'AVL', underlying: 'AVGO', factor: 2, theme: 'AVGO family' },
    { etf: 'AVS', underlying: 'AVGO', factor: -1, theme: 'AVGO family', optional: true },
    { etf: 'PLTZ', underlying: 'PLTR', factor: -2, theme: 'PLTR family' },
  ],
  themes: [
    { id: 'sndk', name: 'SNDK family', symbols: ['SNDK', 'SNDQ'] },
    { id: 'mu', name: 'MU family', symbols: ['MU', 'MULL', 'MUZ'] },
    { id: 'avgo', name: 'AVGO family', symbols: ['AVGO', 'AVL', 'AVS'] },
    { id: 'pltr', name: 'PLTR family', symbols: ['PLTR', 'PLTZ'] },
  ],
  hiddenSymbols: [] as string[],
};

export async function getSettings(c: Context) {
  const res = await query<{ data: unknown }>(`SELECT data FROM settings WHERE id = 1`);
  const data = res.rows[0]?.data;
  if (!data || typeof data !== 'object' || Object.keys(data as object).length === 0) {
    return c.json(DEFAULT_SETTINGS);
  }
  const obj = data as { pairs?: unknown; themes?: unknown; hiddenSymbols?: unknown };
  return c.json({
    pairs: Array.isArray(obj.pairs) ? obj.pairs : DEFAULT_SETTINGS.pairs,
    themes: Array.isArray(obj.themes) ? obj.themes : DEFAULT_SETTINGS.themes,
    hiddenSymbols: Array.isArray(obj.hiddenSymbols)
      ? (obj.hiddenSymbols as string[]).map((s) => String(s).toUpperCase())
      : DEFAULT_SETTINGS.hiddenSymbols,
  });
}

export async function putSettings(c: Context) {
  const body = await c.req.json();
  await query(
    `INSERT INTO settings (id, data) VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [JSON.stringify(body)],
  );
  return c.json(body);
}
