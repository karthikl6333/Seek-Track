import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { query } from './db.js';
import { parseSchwabCsv, type Trade } from './csv.js';

interface TradeRow {
  id: string;
  row_hash: string;
  date: string;
  action: string;
  symbol: string;
  description: string;
  quantity: number;
  price: number;
  fees: number;
  amount: number;
  imported_at: Date | string;
  note: string | null;
}

function rowToTrade(r: TradeRow): Trade {
  return {
    id: r.id,
    rowHash: r.row_hash,
    date: r.date,
    action: r.action,
    symbol: r.symbol,
    description: r.description,
    quantity: Number(r.quantity),
    price: Number(r.price),
    fees: Number(r.fees),
    amount: Number(r.amount),
    importedAt:
      typeof r.imported_at === 'string' ? r.imported_at : r.imported_at.toISOString(),
    note: r.note ?? undefined,
  };
}

export async function insertTradesIdempotent(
  trades: Trade[],
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const t of trades) {
    const res = await query(
      `INSERT INTO trades (
        id, row_hash, date, action, symbol, description,
        quantity, price, fees, amount, imported_at, note
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (row_hash) DO NOTHING`,
      [
        t.id || randomUUID(),
        t.rowHash,
        t.date,
        t.action,
        t.symbol,
        t.description ?? '',
        t.quantity,
        t.price,
        t.fees,
        t.amount,
        t.importedAt || new Date().toISOString(),
        t.note ?? null,
      ],
    );
    if (res.rowCount && res.rowCount > 0) added++;
    else skipped++;
  }
  return { added, skipped };
}

export async function listTrades(c: Context) {
  const res = await query<TradeRow>(
    `SELECT * FROM trades ORDER BY date DESC, imported_at DESC`,
  );
  return c.json(res.rows.map(rowToTrade));
}

export async function postTrades(c: Context) {
  const body = await c.req.json();
  let trades: Trade[] = [];
  if (Array.isArray(body)) {
    trades = body;
  } else if (Array.isArray(body?.trades)) {
    trades = body.trades;
  } else if (typeof body?.csvText === 'string') {
    return importCsv(c, body.csvText);
  } else {
    return c.json({ error: 'Expected trade array or { trades } / { csvText }' }, 400);
  }

  const counts = await insertTradesIdempotent(trades);
  return c.json({ added: counts.added, skipped: counts.skipped, errors: [] });
}

export async function importCsvHandler(c: Context) {
  const body = await c.req.json();
  if (typeof body?.csvText !== 'string') {
    return c.json({ error: 'csvText required' }, 400);
  }
  return importCsv(c, body.csvText);
}

async function importCsv(c: Context, csvText: string) {
  const existing = await query<{ row_hash: string }>(`SELECT row_hash FROM trades`);
  const hashes = new Set(existing.rows.map((r) => r.row_hash));
  const { trades, result } = parseSchwabCsv(csvText, hashes);
  const counts = await insertTradesIdempotent(trades);
  return c.json({
    added: counts.added,
    skipped: result.skipped + counts.skipped,
    errors: result.errors,
  });
}

export async function patchTrade(c: Context) {
  const id = c.req.param('id');
  const body = await c.req.json();
  if (typeof body?.note !== 'string') {
    return c.json({ error: 'note string required' }, 400);
  }
  const res = await query(
    `UPDATE trades SET note = $1 WHERE id = $2 RETURNING id`,
    [body.note, id],
  );
  if (!res.rowCount) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
}
