import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { query } from './db.js';
import { parseSchwabCsv, type Trade } from './csv.js';
import { hashTradeRow } from './hash.js';

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
  source: string | null;
}

function rowToTrade(r: TradeRow): Trade & { source?: string } {
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
    source: r.source ?? 'csv',
  };
}

export async function insertTradesIdempotent(
  trades: Array<Trade & { source?: string }>,
  source = 'csv',
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (const t of trades) {
    const res = await query(
      `INSERT INTO trades (
        id, row_hash, date, action, symbol, description,
        quantity, price, fees, amount, imported_at, note, source
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
        t.source ?? source,
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

  // Manual single fill: { symbol, action, quantity, price, fees?, date?, description? }
  if (body && typeof body.symbol === 'string' && typeof body.action === 'string' && !Array.isArray(body)) {
    return postManualTrade(c, body);
  }

  let trades: Trade[] = [];
  if (Array.isArray(body)) {
    trades = body;
  } else if (Array.isArray(body?.trades)) {
    trades = body.trades;
  } else if (typeof body?.csvText === 'string') {
    return importCsv(c, body.csvText, body.overrideManual !== false);
  } else {
    return c.json(
      { error: 'Expected trade array, manual fill fields, or { trades } / { csvText }' },
      400,
    );
  }

  const counts = await insertTradesIdempotent(trades, 'csv');
  return c.json({ added: counts.added, skipped: counts.skipped, errors: [], overridden: 0 });
}

async function postManualTrade(c: Context, body: Record<string, unknown>) {
  const symbol = String(body.symbol).trim().toUpperCase();
  const action = String(body.action).trim();
  const quantity = Math.abs(Number(body.quantity));
  const price = Number(body.price);
  const fees = Math.abs(Number(body.fees ?? 0));
  const date =
    typeof body.date === 'string' && body.date.trim()
      ? body.date.trim()
      : new Date().toISOString().slice(0, 10);
  const description =
    typeof body.description === 'string' ? body.description : 'Manual fill';

  if (!symbol || !action || !Number.isFinite(quantity) || quantity <= 0) {
    return c.json({ error: 'symbol, action, and positive quantity required' }, 400);
  }
  if (!Number.isFinite(price) || price < 0) {
    return c.json({ error: 'valid price required' }, 400);
  }

  const isSell = /sell/i.test(action) && !/cover/i.test(action);
  const signedQty = isSell || /short/i.test(action) ? -quantity : quantity;
  const amount = -(signedQty * price) - fees;

  const rowHash = hashTradeRow({
    date,
    action,
    symbol,
    description,
    quantity,
    price,
    fees,
    amount,
  });

  const trade: Trade & { source: string } = {
    id: randomUUID(),
    rowHash,
    date,
    action,
    symbol,
    description,
    quantity,
    price,
    fees,
    amount,
    importedAt: new Date().toISOString(),
    note: typeof body.note === 'string' ? body.note : undefined,
    source: 'manual',
  };

  const counts = await insertTradesIdempotent([trade], 'manual');
  if (counts.added === 0) {
    return c.json({
      added: 0,
      skipped: 1,
      errors: [],
      message: 'Identical trade already exists (same row hash)',
      trade,
    });
  }
  return c.json({ added: 1, skipped: 0, errors: [], trade });
}

export async function importCsvHandler(c: Context) {
  const body = await c.req.json();
  if (typeof body?.csvText !== 'string') {
    return c.json({ error: 'csvText required' }, 400);
  }
  // Default ON: re-import overrides conflicting manual trades for symbols in file
  const overrideManual = body.overrideManual !== false;
  return importCsv(c, body.csvText, overrideManual);
}

async function importCsv(c: Context, csvText: string, overrideManual: boolean) {
  const existing = await query<{ row_hash: string }>(`SELECT row_hash FROM trades`);
  const hashes = new Set(existing.rows.map((r) => r.row_hash));
  const { trades, result } = parseSchwabCsv(csvText, hashes);

  let overridden = 0;
  if (overrideManual) {
    // Parse with empty hash set to learn all symbols present in the file (incl. dupes)
    const allInFile = parseSchwabCsv(csvText, new Set());
    const symbols = Array.from(
      new Set(allInFile.trades.map((t) => t.symbol.toUpperCase())),
    );

    if (symbols.length) {
      // CSV wins for symbols in this file: remove conflicting manual additions.
      // Identical CSV rows still dedupe by row_hash on insert.
      const del = await query(
        `DELETE FROM trades
         WHERE source = 'manual'
           AND symbol = ANY($1::text[])
         RETURNING id`,
        [symbols],
      );
      overridden = del.rowCount ?? 0;
    }
  }

  const counts = await insertTradesIdempotent(trades, 'csv');
  return c.json({
    added: counts.added,
    skipped: result.skipped + counts.skipped,
    errors: result.errors,
    overridden,
    overrideManual,
  });
}

export async function patchTrade(c: Context) {
  const id = c.req.param('id');
  const body = await c.req.json();
  if (typeof body?.note !== 'string') {
    return c.json({ error: 'note string required' }, 400);
  }
  const res = await query(`UPDATE trades SET note = $1 WHERE id = $2 RETURNING id`, [
    body.note,
    id,
  ]);
  if (!res.rowCount) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
}
