import type { Context } from 'hono';
import { query } from './db.js';

export interface CryptoPaperState {
  equity: number;
  cash: number;
  buyingPower: number;
  dayPnl: number;
  weekPnl: number;
  status: 'idle' | 'active' | 'review';
  mandateStart: string;
  mandateEnd: string;
  strategyNote: string;
  updatedAt: string;
}

export interface CryptoPaperPosition {
  symbol: string;
  quantity: number;
  avgPrice: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  theme: string;
  updatedAt: string;
}

export interface CryptoPaperOrder {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  filledQty: number;
  avgFillPrice: number | null;
  status: string;
  createdAt: string;
  filledAt: string | null;
}

export interface CryptoPaperJournalEntry {
  id: string;
  symbol: string | null;
  note: string;
  createdAt: string;
}

export interface CryptoPaperSummary {
  state: CryptoPaperState;
  positions: CryptoPaperPosition[];
  recentOrders: CryptoPaperOrder[];
  journalEntries: CryptoPaperJournalEntry[];
  scoreboard: {
    totalPnl: number;
    tradeCount: number;
    winRate: number | null;
  };
}

function toCamelCase<T extends Record<string, any>>(row: Record<string, any>): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

export async function getCryptoPaperSummary(c: Context) {
  const stateRes = await query<{
    equity: number;
    cash: number;
    buying_power: number;
    day_pnl: number;
    week_pnl: number;
    status: string;
    mandate_start: string;
    mandate_end: string;
    strategy_note: string;
    updated_at: string;
  }>(`SELECT * FROM crypto_paper_state WHERE id = 1`);

  const positionsRes = await query<{
    symbol: string;
    quantity: number;
    avg_price: number;
    market_value: number | null;
    unrealized_pnl: number | null;
    theme: string;
    updated_at: string;
  }>(`SELECT * FROM crypto_paper_positions ORDER BY symbol ASC`);

  const ordersRes = await query<{
    id: string;
    symbol: string;
    side: string;
    quantity: number;
    filled_qty: number;
    avg_fill_price: number | null;
    status: string;
    created_at: string;
    filled_at: string | null;
  }>(`SELECT * FROM crypto_paper_orders ORDER BY created_at DESC LIMIT 50`);

  const journalRes = await query<{
    id: string;
    symbol: string | null;
    note: string;
    created_at: string;
  }>(`SELECT * FROM crypto_paper_journal ORDER BY created_at DESC LIMIT 50`);

  const state: CryptoPaperState = stateRes.rows[0]
    ? toCamelCase(stateRes.rows[0])
    : {
        equity: 0,
        cash: 0,
        buyingPower: 0,
        dayPnl: 0,
        weekPnl: 0,
        status: 'idle',
        mandateStart: '2026-09-08',
        mandateEnd: '2026-09-12',
        strategyNote: 'Crypto-only paper trading',
        updatedAt: new Date().toISOString(),
      };

  const positions: CryptoPaperPosition[] = positionsRes.rows.map((r) =>
    toCamelCase<CryptoPaperPosition>(r),
  );
  const recentOrders: CryptoPaperOrder[] = ordersRes.rows.map((r) =>
    toCamelCase<CryptoPaperOrder>(r),
  );
  const journalEntries: CryptoPaperJournalEntry[] = journalRes.rows.map((r) =>
    toCamelCase<CryptoPaperJournalEntry>(r),
  );

  const filledOrders = recentOrders.filter((o) => o.status === 'filled');
  const tradeCount = filledOrders.length;
  const winningTrades = filledOrders.filter((o) => {
    const pos = positions.find((p) => p.symbol === o.symbol);
    return pos && pos.unrealizedPnl && pos.unrealizedPnl > 0;
  }).length;
  const winRate = tradeCount > 0 ? winningTrades / tradeCount : null;

  const summary: CryptoPaperSummary = {
    state,
    positions,
    recentOrders,
    journalEntries,
    scoreboard: {
      totalPnl: state.weekPnl,
      tradeCount,
      winRate,
    },
  };

  return c.json(summary);
}

export async function upsertCryptoPaperState(c: Context) {
  const body = await c.req.json();
  const {
    equity,
    cash,
    buyingPower,
    dayPnl,
    weekPnl,
    status,
    mandateStart,
    mandateEnd,
    strategyNote,
  } = body;

  await query(
    `INSERT INTO crypto_paper_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (id) DO UPDATE SET
       equity = EXCLUDED.equity,
       cash = EXCLUDED.cash,
       buying_power = EXCLUDED.buying_power,
       day_pnl = EXCLUDED.day_pnl,
       week_pnl = EXCLUDED.week_pnl,
       status = EXCLUDED.status,
       mandate_start = EXCLUDED.mandate_start,
       mandate_end = EXCLUDED.mandate_end,
       strategy_note = EXCLUDED.strategy_note,
       updated_at = NOW()`,
    [equity, cash, buyingPower, dayPnl, weekPnl, status, mandateStart, mandateEnd, strategyNote],
  );

  return c.json({ ok: true });
}

export async function upsertCryptoPaperPositions(c: Context) {
  const body = await c.req.json();
  const positions = body.positions as {
    symbol: string;
    quantity: number;
    avgPrice: number;
    marketValue?: number | null;
    unrealizedPnl?: number | null;
    theme?: string;
  }[];

  await query(`DELETE FROM crypto_paper_positions`);

  for (const pos of positions) {
    await query(
      `INSERT INTO crypto_paper_positions (symbol, quantity, avg_price, market_value, unrealized_pnl, theme, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        pos.symbol,
        pos.quantity,
        pos.avgPrice,
        pos.marketValue ?? null,
        pos.unrealizedPnl ?? null,
        pos.theme ?? '',
      ],
    );
  }

  return c.json({ ok: true });
}

export async function upsertCryptoPaperOrders(c: Context) {
  const body = await c.req.json();
  const orders = body.orders as {
    id: string;
    symbol: string;
    side: string;
    quantity: number;
    filledQty?: number;
    avgFillPrice?: number | null;
    status: string;
    createdAt: string;
    filledAt?: string | null;
  }[];

  for (const order of orders) {
    await query(
      `INSERT INTO crypto_paper_orders (id, symbol, side, quantity, filled_qty, avg_fill_price, status, created_at, filled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         filled_qty = EXCLUDED.filled_qty,
         avg_fill_price = EXCLUDED.avg_fill_price,
         status = EXCLUDED.status,
         filled_at = EXCLUDED.filled_at`,
      [
        order.id,
        order.symbol,
        order.side,
        order.quantity,
        order.filledQty ?? 0,
        order.avgFillPrice ?? null,
        order.status,
        order.createdAt,
        order.filledAt ?? null,
      ],
    );
  }

  return c.json({ ok: true });
}

export async function postCryptoPaperJournal(c: Context) {
  const body = await c.req.json();
  const { id, symbol, note } = body;

  await query(
    `INSERT INTO crypto_paper_journal (id, symbol, note, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       symbol = EXCLUDED.symbol,
       note = EXCLUDED.note`,
    [id, symbol ?? null, note],
  );

  return c.json({ ok: true });
}

export async function refreshCryptoPaperLivePnl(c: Context) {
  const alpacaApiKey = process.env.ALPACA_CRYPTO_API_KEY;
  const alpacaSecretKey = process.env.ALPACA_CRYPTO_SECRET_KEY;

  if (!alpacaApiKey || !alpacaSecretKey) {
    return c.json(
      {
        ok: false,
        error: 'ALPACA_CRYPTO_API_KEY and ALPACA_CRYPTO_SECRET_KEY environment variables required',
      },
      500,
    );
  }

  const alpacaPaperUrl = 'https://paper-api.alpaca.markets';

  try {
    const accountRes = await fetch(`${alpacaPaperUrl}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': alpacaApiKey,
        'APCA-API-SECRET-KEY': alpacaSecretKey,
      },
    });

    if (!accountRes.ok) {
      const errorText = await accountRes.text();
      return c.json(
        {
          ok: false,
          error: `Alpaca API error: ${accountRes.status} ${errorText}`,
        },
        500,
      );
    }

    const account = await accountRes.json();

    const positionsRes = await fetch(`${alpacaPaperUrl}/v2/positions`, {
      headers: {
        'APCA-API-KEY-ID': alpacaApiKey,
        'APCA-API-SECRET-KEY': alpacaSecretKey,
      },
    });

    if (!positionsRes.ok) {
      const errorText = await positionsRes.text();
      return c.json(
        {
          ok: false,
          error: `Alpaca positions API error: ${positionsRes.status} ${errorText}`,
        },
        500,
      );
    }

    const positions = await positionsRes.json();

    const equity = parseFloat(String((account as any).equity || '0'));
    const cash = parseFloat(String((account as any).cash || '0'));
    const buyingPower = parseFloat(String((account as any).buying_power || '0'));

    const existingStateRes = await query<{
      day_pnl: number;
      week_pnl: number;
      status: string;
      mandate_start: string;
      mandate_end: string;
      strategy_note: string;
    }>(`SELECT day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note FROM crypto_paper_state WHERE id = 1`);

    const existingState = existingStateRes.rows[0];
    const dayPnl = parseFloat(String((account as any).equity)) - parseFloat(String((account as any).last_equity || (account as any).equity));
    const weekPnl = existingState?.week_pnl || 0;

    await query(
      `INSERT INTO crypto_paper_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (id) DO UPDATE SET
         equity = EXCLUDED.equity,
         cash = EXCLUDED.cash,
         buying_power = EXCLUDED.buying_power,
         day_pnl = EXCLUDED.day_pnl,
         updated_at = NOW()`,
      [
        equity,
        cash,
        buyingPower,
        dayPnl,
        weekPnl,
        existingState?.status || 'active',
        existingState?.mandate_start || '2026-09-08',
        existingState?.mandate_end || '2026-09-12',
        existingState?.strategy_note || 'Crypto-only paper trading',
      ],
    );

    await query(`DELETE FROM crypto_paper_positions`);

    for (const pos of positions as any[]) {
      await query(
        `INSERT INTO crypto_paper_positions (symbol, quantity, avg_price, market_value, unrealized_pnl, theme, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          pos.symbol,
          parseFloat(pos.qty),
          parseFloat(pos.avg_entry_price),
          parseFloat(pos.market_value),
          parseFloat(pos.unrealized_pl),
          pos.asset_class === 'crypto' ? 'Crypto' : '',
        ],
      );
    }

    return c.json({
      ok: true,
      refreshedAt: new Date().toISOString(),
      equity,
      cash,
      positions: (positions as any[]).length,
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: String(err),
      },
      500,
    );
  }
}
