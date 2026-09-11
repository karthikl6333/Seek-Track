import type { Context } from 'hono';
import { query } from './db.js';

export interface PaperState {
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

export interface PaperPosition {
  symbol: string;
  quantity: number;
  avgPrice: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  theme: string;
  updatedAt: string;
}

export interface PaperOrder {
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

export interface PaperJournalEntry {
  id: string;
  symbol: string | null;
  note: string;
  createdAt: string;
}

export interface PaperSummary {
  state: PaperState;
  positions: PaperPosition[];
  recentOrders: PaperOrder[];
  journalEntries: PaperJournalEntry[];
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

export async function getPaperSummary(c: Context) {
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
  }>(`SELECT * FROM paper_state WHERE id = 1`);

  const positionsRes = await query<{
    symbol: string;
    quantity: number;
    avg_price: number;
    market_value: number | null;
    unrealized_pnl: number | null;
    theme: string;
    updated_at: string;
  }>(`SELECT * FROM paper_positions ORDER BY symbol ASC`);

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
  }>(`SELECT * FROM paper_orders ORDER BY created_at DESC LIMIT 50`);

  const journalRes = await query<{
    id: string;
    symbol: string | null;
    note: string;
    created_at: string;
  }>(`SELECT * FROM paper_journal ORDER BY created_at DESC LIMIT 50`);

  const state: PaperState = stateRes.rows[0]
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
        strategyNote: 'Levered semis / mega-cap swing',
        updatedAt: new Date().toISOString(),
      };

  const positions: PaperPosition[] = positionsRes.rows.map((r) => toCamelCase<PaperPosition>(r));
  const recentOrders: PaperOrder[] = ordersRes.rows.map((r) => toCamelCase<PaperOrder>(r));
  const journalEntries: PaperJournalEntry[] = journalRes.rows.map((r) =>
    toCamelCase<PaperJournalEntry>(r),
  );

  const filledOrders = recentOrders.filter((o) => o.status === 'filled');
  const tradeCount = filledOrders.length;
  const winningTrades = filledOrders.filter((o) => {
    const pos = positions.find((p) => p.symbol === o.symbol);
    return pos && pos.unrealizedPnl && pos.unrealizedPnl > 0;
  }).length;
  const winRate = tradeCount > 0 ? winningTrades / tradeCount : null;

  const summary: PaperSummary = {
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

export async function upsertPaperState(c: Context) {
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
    `INSERT INTO paper_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note, updated_at)
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

export async function upsertPaperPositions(c: Context) {
  const body = await c.req.json();
  const positions = body.positions as {
    symbol: string;
    quantity: number;
    avgPrice: number;
    marketValue?: number | null;
    unrealizedPnl?: number | null;
    theme?: string;
  }[];

  await query(`DELETE FROM paper_positions`);

  for (const pos of positions) {
    await query(
      `INSERT INTO paper_positions (symbol, quantity, avg_price, market_value, unrealized_pnl, theme, updated_at)
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

export async function upsertPaperOrders(c: Context) {
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
      `INSERT INTO paper_orders (id, symbol, side, quantity, filled_qty, avg_fill_price, status, created_at, filled_at)
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

export async function postPaperJournal(c: Context) {
  const body = await c.req.json();
  const { id, symbol, note } = body;

  await query(
    `INSERT INTO paper_journal (id, symbol, note, created_at)
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
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  unrealized_pl: string;
  side: string;
}

export async function refreshPaperFromAlpaca(c: Context) {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_SECRET_KEY;

  if (!apiKey || !apiSecret) {
    return c.json(
      {
        ok: false,
        error:
          'Alpaca API credentials not configured. Set ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables.',
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
    }>(`SELECT status, mandate_start, mandate_end, strategy_note FROM paper_state WHERE id = 1`);

    const existingState = existingStateRes.rows[0] || {
      status: 'active',
      mandate_start: '2026-09-08',
      mandate_end: '2026-09-12',
      strategy_note: 'Levered semis / mega-cap swing',
    };

    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);
    const buyingPower = parseFloat(account.buying_power);

    const prevEquityRes = await query<{ equity: number }>(
      `SELECT equity FROM paper_state WHERE id = 1`,
    );
    const prevEquity = prevEquityRes.rows[0]?.equity ?? equity;
    const dayPnl = equity - prevEquity;

    const weekPnlRes = await query<{ week_pnl: number }>(
      `SELECT week_pnl FROM paper_state WHERE id = 1`,
    );
    const weekPnl = weekPnlRes.rows[0]?.week_pnl ?? 0;

    await query(
      `INSERT INTO paper_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note, updated_at)
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
        existingState.status,
        existingState.mandate_start,
        existingState.mandate_end,
        existingState.strategy_note,
      ],
    );

    await query(`DELETE FROM paper_positions`);

    // Fetch app settings to derive themes from symbol mappings
    const settingsRes = await query<{ data: any }>(
      `SELECT data FROM settings WHERE id = 1`
    );
    const settings = settingsRes.rows[0]?.data;
    const themes = settings?.themes || [];
    
    // Helper to derive theme from symbol
    const getTheme = (symbol: string): string => {
      const upper = symbol.toUpperCase();
      const found = themes.find((t: any) => 
        t.symbols && t.symbols.map((s: string) => s.toUpperCase()).includes(upper)
      );
      return found?.name || '';
    };

    for (const pos of positions) {
      const existingPosRes = await query<{ theme: string }>(
        `SELECT theme FROM paper_positions WHERE symbol = $1`,
        [pos.symbol],
      );
      // Prefer existing theme, fallback to derived theme from settings
      const theme = existingPosRes.rows[0]?.theme || getTheme(pos.symbol);

      await query(
        `INSERT INTO paper_positions (symbol, quantity, avg_price, market_value, unrealized_pnl, theme, updated_at)
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
    console.error('Alpaca refresh error:', err);
    return c.json(
      {
        ok: false,
        error: `Failed to refresh from Alpaca: ${String(err)}`,
      },
      500,
    );
  }
}
