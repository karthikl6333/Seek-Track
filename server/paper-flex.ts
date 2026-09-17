import type { Context } from 'hono';
import { query } from './db.js';

export interface PaperFlexState {
  equity: number;
  cash: number;
  buyingPower: number;
  dayPnl: number;
  weekPnl: number;
  t0Equity: number;
  status: 'idle' | 'active' | 'review';
  mandateStart: string;
  mandateEnd: string;
  strategyNote: string;
  updatedAt: string;
}

export interface PaperFlexPosition {
  symbol: string;
  quantity: number;
  avgPrice: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  theme: string;
  updatedAt: string;
}

export interface PaperFlexOrder {
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

export interface PaperFlexJournalEntry {
  id: string;
  symbol: string | null;
  note: string;
  createdAt: string;
}

export interface PaperFlexSummary {
  state: PaperFlexState;
  positions: PaperFlexPosition[];
  recentOrders: PaperFlexOrder[];
  journalEntries: PaperFlexJournalEntry[];
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

export async function getPaperFlexSummary(c: Context) {
  const stateRes = await query<{
    equity: number;
    cash: number;
    buying_power: number;
    day_pnl: number;
    week_pnl: number;
    t0_equity: number;
    status: string;
    mandate_start: string;
    mandate_end: string;
    strategy_note: string;
    updated_at: string;
  }>(`SELECT * FROM paper_flex_state WHERE id = 1`);

  const positionsRes = await query<{
    symbol: string;
    quantity: number;
    avg_price: number;
    market_value: number | null;
    unrealized_pnl: number | null;
    theme: string;
    updated_at: string;
  }>(`SELECT * FROM paper_flex_positions ORDER BY symbol ASC`);

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
  }>(`SELECT * FROM paper_flex_orders ORDER BY created_at DESC LIMIT 50`);

  const journalRes = await query<{
    id: string;
    symbol: string | null;
    note: string;
    created_at: string;
  }>(`SELECT * FROM paper_flex_journal ORDER BY created_at DESC LIMIT 50`);

  const state: PaperFlexState = stateRes.rows[0]
    ? toCamelCase(stateRes.rows[0])
    : {
        equity: 0,
        cash: 0,
        buyingPower: 0,
        dayPnl: 0,
        weekPnl: 0,
        t0Equity: 200000,
        status: 'idle',
        mandateStart: '2026-09-08',
        mandateEnd: '2026-09-12',
        strategyNote: 'FLEX-STK / A1 ORB-DAY-ETF',
        updatedAt: new Date().toISOString(),
      };

  const positions: PaperFlexPosition[] = positionsRes.rows.map((r) => toCamelCase<PaperFlexPosition>(r));
  const recentOrders: PaperFlexOrder[] = ordersRes.rows.map((r) => toCamelCase<PaperFlexOrder>(r));
  const journalEntries: PaperFlexJournalEntry[] = journalRes.rows.map((r) =>
    toCamelCase<PaperFlexJournalEntry>(r),
  );

  const filledOrders = recentOrders.filter((o) => o.status === 'filled');
  const tradeCount = filledOrders.length;
  const winningTrades = filledOrders.filter((o) => {
    const pos = positions.find((p) => p.symbol === o.symbol);
    return pos && pos.unrealizedPnl && pos.unrealizedPnl > 0;
  }).length;
  const winRate = tradeCount > 0 ? winningTrades / tradeCount : null;

  const totalPnl = state.equity - state.t0Equity;

  const summary: PaperFlexSummary = {
    state,
    positions,
    recentOrders,
    journalEntries,
    scoreboard: {
      totalPnl,
      tradeCount,
      winRate,
    },
  };

  return c.json(summary);
}

export async function upsertPaperFlexState(c: Context) {
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
    `INSERT INTO paper_flex_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note, updated_at)
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

export async function upsertPaperFlexPositions(c: Context) {
  const body = await c.req.json();
  const positions = body.positions as {
    symbol: string;
    quantity: number;
    avgPrice: number;
    marketValue?: number | null;
    unrealizedPnl?: number | null;
    theme?: string;
  }[];

  await query(`DELETE FROM paper_flex_positions`);

  for (const pos of positions) {
    await query(
      `INSERT INTO paper_flex_positions (symbol, quantity, avg_price, market_value, unrealized_pnl, theme, updated_at)
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

export async function upsertPaperFlexOrders(c: Context) {
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
      `INSERT INTO paper_flex_orders (id, symbol, side, quantity, filled_qty, avg_fill_price, status, created_at, filled_at)
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

export async function postPaperFlexJournal(c: Context) {
  const body = await c.req.json();
  const { id, symbol, note } = body;

  await query(
    `INSERT INTO paper_flex_journal (id, symbol, note, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       symbol = EXCLUDED.symbol,
       note = EXCLUDED.note`,
    [id, symbol ?? null, note],
  );

  return c.json({ ok: true });
}

interface AlpacaAccount {
  equity: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  long_market_value?: string;
  short_market_value?: string;
  last_equity?: string;
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  unrealized_pl: string;
  side: string;
}

export async function refreshPaperFlexFromAlpaca(c: Context) {
  const apiKey = process.env.ALPACA_FLEX_API_KEY;
  const apiSecret = process.env.ALPACA_FLEX_SECRET_KEY;

  if (!apiKey || !apiSecret) {
    return c.json(
      {
        ok: false,
        error:
          'Alpaca FLEX API credentials not configured. Set ALPACA_FLEX_API_KEY and ALPACA_FLEX_SECRET_KEY environment variables.',
      },
      503,
    );
  }

  const PAPER_API_BASE = 'https://paper-api.alpaca.markets';

  try {
    const accountRes = await fetch(`${PAPER_API_BASE}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
    });

    if (!accountRes.ok) {
      const errText = await accountRes.text().catch(() => '');
      return c.json(
        {
          ok: false,
          error: `Alpaca API error (${accountRes.status}): ${errText || accountRes.statusText}`,
        },
        502,
      );
    }

    const account = (await accountRes.json()) as AlpacaAccount;

    const positionsRes = await fetch(`${PAPER_API_BASE}/v2/positions`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
    });

    if (!positionsRes.ok) {
      const errText = await positionsRes.text().catch(() => '');
      return c.json(
        {
          ok: false,
          error: `Alpaca positions API error (${positionsRes.status}): ${errText || positionsRes.statusText}`,
        },
        502,
      );
    }

    const positions = (await positionsRes.json()) as AlpacaPosition[];

    const existingStateRes = await query<{
      status: string;
      mandate_start: string;
      mandate_end: string;
      strategy_note: string;
      t0_equity: number;
    }>(`SELECT status, mandate_start, mandate_end, strategy_note, t0_equity FROM paper_flex_state WHERE id = 1`);

    const existingState = existingStateRes.rows[0] || {
      status: 'active',
      mandate_start: '2026-09-08',
      mandate_end: '2026-09-12',
      strategy_note: 'FLEX-STK / A1 ORB-DAY-ETF',
      t0_equity: 200000,
    };

    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);
    const buyingPower = parseFloat(account.buying_power);

    const lastEquity = account.last_equity ? parseFloat(account.last_equity) : equity;
    const dayPnl = equity - lastEquity;

    const weekPnlRes = await query<{ week_pnl: number }>(
      `SELECT week_pnl FROM paper_flex_state WHERE id = 1`,
    );
    const weekPnl = weekPnlRes.rows[0]?.week_pnl ?? 0;

    await query(
      `INSERT INTO paper_flex_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note, t0_equity, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
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
        existingState.status,
        existingState.mandate_start,
        existingState.mandate_end,
        existingState.strategy_note,
        existingState.t0_equity,
      ],
    );

    await query(`DELETE FROM paper_flex_positions`);

    const settingsRes = await query<{ data: any }>(
      `SELECT data FROM settings WHERE id = 1`
    );
    const settings = settingsRes.rows[0]?.data;
    const themes = settings?.themes || [];
    
    const getTheme = (symbol: string): string => {
      const upper = symbol.toUpperCase();
      const found = themes.find((t: any) => 
        t.symbols && t.symbols.map((s: string) => s.toUpperCase()).includes(upper)
      );
      return found?.name || '';
    };

    for (const pos of positions) {
      const existingPosRes = await query<{ theme: string }>(
        `SELECT theme FROM paper_flex_positions WHERE symbol = $1`,
        [pos.symbol],
      );
      const theme = existingPosRes.rows[0]?.theme || getTheme(pos.symbol);

      await query(
        `INSERT INTO paper_flex_positions (symbol, quantity, avg_price, market_value, unrealized_pnl, theme, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          pos.symbol,
          parseFloat(pos.qty) * (pos.side === 'short' ? -1 : 1),
          parseFloat(pos.avg_entry_price),
          parseFloat(pos.market_value),
          parseFloat(pos.unrealized_pl),
          theme,
        ],
      );
    }

    return c.json({ ok: true, refreshedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Alpaca FLEX refresh error:', err);
    return c.json(
      {
        ok: false,
        error: `Failed to refresh from Alpaca FLEX: ${String(err)}`,
      },
      500,
    );
  }
}
