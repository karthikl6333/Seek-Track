/**
 * Atomic, idempotent "replace all positions" for the paper / crypto-paper / paper-flex tables.
 *
 * Why: the old code ran `DELETE FROM <table>` and then one `INSERT` per row as separate
 * statements. On Neon that sequence ran inside one request-scoped session and the race window was
 * tiny; on D1 every query auto-commits, so two concurrent refreshes interleave
 * (A: DELETE, B: DELETE, A: INSERT X, B: INSERT X → UNIQUE constraint failed: <table>.symbol).
 *
 * Now:
 *  1. Upsert every current position with INSERT ... ON CONFLICT(symbol) DO UPDATE
 *     (multi-row, ≤16 rows / 96 bound params per statement, well under D1's 100).
 *  2. Delete only symbols that are no longer present: `NOT (symbol = ANY($1))`, which the D1
 *     adapter turns into `NOT IN (SELECT value FROM json_each(?1))` (1 bound param).
 *  3. All statements go in ONE db.batch() call, which D1 runs as a single transaction.
 *     Concurrent refreshes therefore serialize and the result is the same whichever runs last.
 */
import { batch as dbBatch } from './db.js';

export const POSITION_TABLES = ['paper_positions', 'crypto_paper_positions', 'paper_flex_positions'] as const;
export type PositionTable = (typeof POSITION_TABLES)[number];

export interface PositionRow {
  symbol: string;
  quantity: number;
  avgPrice: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  theme: string;
}

export interface ReplaceOptions {
  /**
   * true: keep a non-empty theme already stored for the symbol (Alpaca refresh, where the theme was
   * set by the user / derived earlier). false: the incoming theme wins (explicit API upsert).
   */
  preserveExistingTheme?: boolean;
}

type Stmt = { text: string; params?: unknown[] };

const PARAMS_PER_ROW = 6;
/** D1 limit is 100 bound params per statement → 16 rows × 6 = 96. */
export const MAX_ROWS_PER_STATEMENT = Math.floor(100 / PARAMS_PER_ROW);
/** D1 limit is 50 statements per batch; keep one slot for the DELETE. */
export const MAX_POSITIONS = (50 - 1) * MAX_ROWS_PER_STATEMENT;

const finiteOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** Normalize + de-duplicate (last row for a symbol wins). Rows without a symbol/quantity are dropped. */
export function normalizePositions(rows: PositionRow[]): PositionRow[] {
  const bySymbol = new Map<string, PositionRow>();
  for (const r of rows) {
    const symbol = typeof r?.symbol === 'string' ? r.symbol.trim() : '';
    const quantity = finiteOrNull(r?.quantity);
    if (!symbol || quantity === null) continue;
    bySymbol.set(symbol, {
      symbol,
      quantity,
      avgPrice: finiteOrNull(r.avgPrice) ?? 0,
      marketValue: finiteOrNull(r.marketValue),
      unrealizedPnl: finiteOrNull(r.unrealizedPnl),
      theme: typeof r.theme === 'string' ? r.theme : '',
    });
  }
  return Array.from(bySymbol.values());
}

/** Pure: build the statements for an atomic replace. Exported for tests. */
export function buildReplacePositionsStatements(
  table: PositionTable,
  rows: PositionRow[],
  opts: ReplaceOptions = {},
): Stmt[] {
  if (!POSITION_TABLES.includes(table)) throw new Error(`Unknown positions table ${table}`);
  const positions = normalizePositions(rows);
  if (positions.length > MAX_POSITIONS) {
    throw new Error(`Too many positions (${positions.length} > ${MAX_POSITIONS}) for one atomic batch`);
  }

  const themeSet = opts.preserveExistingTheme
    ? `theme = CASE WHEN ${table}.theme IS NOT NULL AND ${table}.theme <> '' THEN ${table}.theme ELSE EXCLUDED.theme END`
    : `theme = EXCLUDED.theme`;

  const stmts: Stmt[] = [];
  for (let i = 0; i < positions.length; i += MAX_ROWS_PER_STATEMENT) {
    const chunk = positions.slice(i, i + MAX_ROWS_PER_STATEMENT);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((p, j) => {
      const b = j * PARAMS_PER_ROW;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, NOW())`);
      params.push(p.symbol, p.quantity, p.avgPrice, p.marketValue, p.unrealizedPnl, p.theme);
    });
    stmts.push({
      text: `INSERT INTO ${table} (symbol, quantity, avg_price, market_value, unrealized_pnl, theme, updated_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (symbol) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         avg_price = EXCLUDED.avg_price,
         market_value = EXCLUDED.market_value,
         unrealized_pnl = EXCLUDED.unrealized_pnl,
         ${themeSet},
         updated_at = EXCLUDED.updated_at`,
      params,
    });
  }

  // Remove symbols that are no longer held. With no positions this deletes everything.
  stmts.push({
    text: `DELETE FROM ${table} WHERE NOT (symbol = ANY($1))`,
    params: [positions.map((p) => p.symbol)],
  });
  return stmts;
}

/** Atomically make `table` contain exactly `rows`. Safe to call concurrently. */
export async function replacePositions(
  table: PositionTable,
  rows: PositionRow[],
  opts: ReplaceOptions = {},
): Promise<{ upserted: number }> {
  const stmts = buildReplacePositionsStatements(table, rows, opts);
  await dbBatch(stmts);
  return { upserted: normalizePositions(rows).length };
}

/** Map an Alpaca /v2/positions entry to a PositionRow. */
export function alpacaToPositionRow(
  pos: { symbol: string; qty: string | number; side?: string; avg_entry_price: string | number; market_value?: string | number | null; unrealized_pl?: string | number | null },
  theme: string,
  opts: { signedByShortSide?: boolean } = {},
): PositionRow {
  const qty = finiteOrNull(pos.qty) ?? Number.NaN;
  return {
    symbol: pos.symbol,
    // Same sign convention as the previous code: qty × -1 for side=short when requested.
    quantity: opts.signedByShortSide && pos.side === 'short' ? qty * -1 : qty,
    avgPrice: finiteOrNull(pos.avg_entry_price) ?? 0,
    marketValue: finiteOrNull(pos.market_value),
    unrealizedPnl: finiteOrNull(pos.unrealized_pl),
    theme,
  };
}
