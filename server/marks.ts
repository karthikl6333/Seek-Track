import type { Context } from 'hono';
import { query } from './db.js';

export async function getMarks(c: Context) {
  const res = await query<{ symbol: string; price: number; updated_at: Date | string }>(
    `SELECT symbol, price, updated_at FROM marks ORDER BY symbol`,
  );
  const out: Record<string, number> = {};
  for (const r of res.rows) out[r.symbol] = Number(r.price);
  return c.json(out);
}

export async function putMarks(c: Context) {
  const body = await c.req.json();
  const now = new Date().toISOString();

  if (body && typeof body.symbol === 'string' && typeof body.price === 'number') {
    const symbol = body.symbol.toUpperCase();
    await query(
      `INSERT INTO marks (symbol, price, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price, updated_at = EXCLUDED.updated_at`,
      [symbol, body.price, now],
    );
    return c.json({ ok: true, symbol, price: body.price });
  }

  if (body && typeof body.marks === 'object' && body.marks !== null) {
    for (const [symbol, price] of Object.entries(body.marks as Record<string, unknown>)) {
      if (typeof price !== 'number') continue;
      await query(
        `INSERT INTO marks (symbol, price, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price, updated_at = EXCLUDED.updated_at`,
        [symbol.toUpperCase(), price, now],
      );
    }
    return c.json({ ok: true });
  }

  return c.json({ error: 'Expected { symbol, price } or { marks: Record }' }, 400);
}
