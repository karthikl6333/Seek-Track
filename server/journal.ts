import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { query } from './db.js';

interface JournalRow {
  id: string;
  symbol: string | null;
  date: string;
  title: string;
  body: string;
  created_at: Date | string;
}

function rowToEntry(r: JournalRow) {
  return {
    id: r.id,
    symbol: r.symbol ?? undefined,
    date: r.date,
    title: r.title,
    body: r.body,
    createdAt:
      typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
  };
}

export async function listJournal(c: Context) {
  const res = await query<JournalRow>(
    `SELECT * FROM journal ORDER BY date DESC, created_at DESC`,
  );
  return c.json(res.rows.map(rowToEntry));
}

export async function postJournal(c: Context) {
  const body = await c.req.json();
  const entry = {
    id: typeof body.id === 'string' ? body.id : randomUUID(),
    date: String(body.date ?? ''),
    symbol: body.symbol ? String(body.symbol).toUpperCase() : null,
    title: String(body.title ?? ''),
    body: String(body.body ?? ''),
    createdAt: typeof body.createdAt === 'string' ? body.createdAt : new Date().toISOString(),
  };
  if (!entry.date) return c.json({ error: 'date required' }, 400);

  await query(
    `INSERT INTO journal (id, symbol, date, title, body, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       symbol = EXCLUDED.symbol,
       date = EXCLUDED.date,
       title = EXCLUDED.title,
       body = EXCLUDED.body`,
    [entry.id, entry.symbol, entry.date, entry.title, entry.body, entry.createdAt],
  );
  return c.json(entry);
}

export async function deleteJournal(c: Context) {
  const id = c.req.query('id') || c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);
  await query(`DELETE FROM journal WHERE id = $1`, [id]);
  return c.json({ ok: true });
}
