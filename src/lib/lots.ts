import type { OpenLot, SymbolPosition, ThemeDef, ThemeSummary, Trade } from '../types';
import { themeForSymbol } from './pairs';

/** Cancel / Canceled / Cancelled — must not open or close lots. */
function isCancelledAction(action: string): boolean {
  return /\bcancell?ed?\b/i.test(action) || action.toLowerCase().includes('cancel');
}

/**
 * Non-trade / cash / interest / journal rows that must not affect positions.
 * Journals are ignored unless we can safely model them (we cannot yet).
 */
export function isNonTradeAction(action: string): boolean {
  const a = action.toLowerCase().trim();
  if (!a) return true;
  if (isCancelledAction(action)) return true;
  if (a.includes('wire')) return true; // Wire Sent, Wire Received, …
  if (a.includes('interest')) return true; // Credit Interest, Margin Interest
  if (a === 'journal' || a.startsWith('journal ') || a.includes('journal ')) return true;
  if (a.includes('funds received') || a.includes('funds sent')) return true;
  if (a.includes('transfer')) return true;
  if (a.includes('adj') && a.includes('cash')) return true;
  return false;
}

function isBuy(action: string): boolean {
  const a = action.toLowerCase();
  if (isCancelledAction(action)) return false;
  if (a.includes('cover')) return false;
  return a.includes('buy') || a.startsWith('bought') || a.includes('buy to open');
}

function isSell(action: string): boolean {
  const a = action.toLowerCase();
  if (isCancelledAction(action)) return false;
  return (
    (a.includes('sell') && !a.includes('short')) ||
    a === 'sell' ||
    a.startsWith('sold') ||
    a.includes('sell to close')
  );
}

function isBuyToCover(action: string): boolean {
  if (isCancelledAction(action)) return false;
  return action.toLowerCase().includes('buy to cover') || action.toLowerCase().includes('cover');
}

function isSellShort(action: string): boolean {
  if (isCancelledAction(action)) return false;
  return action.toLowerCase().includes('short');
}

/** Sort trades chronologically for FIFO lot matching. */
function sortTrades(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    const da = Date.parse(a.date) || 0;
    const db = Date.parse(b.date) || 0;
    if (da !== db) return da - db;
    return a.importedAt.localeCompare(b.importedAt) || a.id.localeCompare(b.id);
  });
}

export interface LotEngineResult {
  positions: SymbolPosition[];
  realizedBySymbol: Record<string, number>;
  themes: ThemeSummary[];
}

/**
 * FIFO long/short lot engine.
 * Buys open long lots; sells close them (realized).
 * Sell Short opens negative qty lots; Buy to Cover closes them.
 */
export function computePositions(
  trades: Trade[],
  themes: ThemeDef[],
  marks: Record<string, number>,
): LotEngineResult {
  const bySymbol = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!t.symbol) continue;
    if (isNonTradeAction(t.action)) continue;
    const list = bySymbol.get(t.symbol) ?? [];
    list.push(t);
    bySymbol.set(t.symbol, list);
  }

  const positions: SymbolPosition[] = [];
  const realizedBySymbol: Record<string, number> = {};

  for (const [symbol, symTrades] of bySymbol) {
    const lots: OpenLot[] = [];
    let realized = 0;
    const ordered = sortTrades(symTrades);

    for (const t of ordered) {
      const qty = Math.abs(t.quantity);
      if (qty === 0) continue;
      if (isNonTradeAction(t.action)) continue;
      const fees = Math.abs(t.fees);

      if (isSellShort(t.action)) {
        // Open short: negative quantity lot; proceeds = price (credit)
        lots.push({
          id: crypto.randomUUID(),
          symbol,
          quantity: -qty,
          costPerShare: t.price,
          feesAllocated: fees,
          openDate: t.date,
          tradeId: t.id,
        });
      } else if (isBuyToCover(t.action)) {
        realized += closeLots(lots, qty, t.price, fees, 'cover');
      } else if (isBuy(t.action)) {
        lots.push({
          id: crypto.randomUUID(),
          symbol,
          quantity: qty,
          costPerShare: t.price,
          feesAllocated: fees,
          openDate: t.date,
          tradeId: t.id,
        });
      } else if (isSell(t.action)) {
        realized += closeLots(lots, qty, t.price, fees, 'sell');
      }
    }

    const netQty = lots.reduce((s, l) => s + l.quantity, 0);
    const absCost = lots.reduce((s, l) => s + Math.abs(l.quantity) * l.costPerShare + l.feesAllocated, 0);
    const signedCost = lots.reduce((s, l) => {
      // Long: cost basis positive cash out; short: credit
      if (l.quantity >= 0) return s + l.quantity * l.costPerShare + l.feesAllocated;
      return s + Math.abs(l.quantity) * l.costPerShare - l.feesAllocated; // short proceeds net of fees
    }, 0);

    const avgCost =
      netQty !== 0
        ? lots.reduce((s, l) => s + Math.abs(l.quantity) * l.costPerShare, 0) / Math.abs(netQty)
        : 0;

    const mark = marks[symbol] ?? null;
    let marketValue: number | null = null;
    let unrealizedPnl: number | null = null;
    let unrealizedPnlPct: number | null = null;

    if (mark !== null && netQty !== 0) {
      marketValue = netQty * mark;
      // Long: MV - cost; Short: entry proceeds - buyback (mark)
      if (netQty > 0) {
        const costBasisLong = lots
          .filter((l) => l.quantity > 0)
          .reduce((s, l) => s + l.quantity * l.costPerShare + l.feesAllocated, 0);
        unrealizedPnl = marketValue - costBasisLong;
        unrealizedPnlPct = costBasisLong !== 0 ? (unrealizedPnl / costBasisLong) * 100 : null;
      } else {
        const shortLots = lots.filter((l) => l.quantity < 0);
        const shortProceeds = shortLots.reduce(
          (s, l) => s + Math.abs(l.quantity) * l.costPerShare - l.feesAllocated,
          0,
        );
        const buyback = Math.abs(netQty) * mark;
        unrealizedPnl = shortProceeds - buyback;
        unrealizedPnlPct = shortProceeds !== 0 ? (unrealizedPnl / shortProceeds) * 100 : null;
      }
    }

    realizedBySymbol[symbol] = realized;

    if (netQty !== 0 || realized !== 0) {
      positions.push({
        symbol,
        theme: themeForSymbol(symbol, themes),
        quantity: netQty,
        avgCost,
        costBasis: netQty > 0 ? absCost : signedCost,
        markPrice: mark,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPct,
        realizedPnl: realized,
        openLots: lots.map((l) => ({ ...l })),
      });
    }
  }

  positions.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const themeMap = new Map<string, ThemeSummary>();
  for (const p of positions) {
    const t = themeMap.get(p.theme) ?? {
      theme: p.theme,
      realizedPnl: 0,
      unrealizedPnl: 0,
      costBasis: 0,
      symbols: [],
    };
    t.realizedPnl += p.realizedPnl;
    if (p.unrealizedPnl !== null && t.unrealizedPnl !== null) {
      t.unrealizedPnl += p.unrealizedPnl;
    } else if (p.unrealizedPnl === null) {
      // keep numeric if we have partial marks — treat missing as 0 contribution but flag null if all missing
    }
    t.costBasis += Math.abs(p.costBasis);
    if (!t.symbols.includes(p.symbol)) t.symbols.push(p.symbol);
    themeMap.set(p.theme, t);
  }

  // Fix unrealized null: if any position in theme lacks mark and has qty, set theme unrealized null
  for (const t of themeMap.values()) {
    const related = positions.filter((p) => p.theme === t.theme && p.quantity !== 0);
    if (related.some((p) => p.unrealizedPnl === null)) {
      const known = related.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
      t.unrealizedPnl = related.every((p) => p.unrealizedPnl === null) ? null : known;
    }
  }

  return {
    positions,
    realizedBySymbol,
    themes: Array.from(themeMap.values()).sort((a, b) => a.theme.localeCompare(b.theme)),
  };
}

function closeLots(
  lots: OpenLot[],
  qtyToClose: number,
  exitPrice: number,
  exitFees: number,
  mode: 'sell' | 'cover',
): number {
  let remaining = qtyToClose;
  let realized = 0;
  let feesLeft = exitFees;

  while (remaining > 1e-10 && lots.length > 0) {
    // For sell: close positive lots; for cover: close negative lots
    const idx = lots.findIndex((l) => (mode === 'sell' ? l.quantity > 0 : l.quantity < 0));
    if (idx < 0) break;
    const lot = lots[idx];
    const lotQty = Math.abs(lot.quantity);
    const take = Math.min(lotQty, remaining);
    const fraction = take / lotQty;
    const entryFees = lot.feesAllocated * fraction;
    const exitFeeShare = feesLeft * (take / qtyToClose);

    if (mode === 'sell') {
      // Proceeds - cost - fees
      realized += take * exitPrice - take * lot.costPerShare - entryFees - exitFeeShare;
      lot.quantity -= take;
    } else {
      // Short: entry credit - cover cost - fees
      realized += take * lot.costPerShare - take * exitPrice - entryFees - exitFeeShare;
      lot.quantity += take; // toward zero
    }

    lot.feesAllocated -= entryFees;
    feesLeft -= exitFeeShare;
    remaining -= take;

    if (Math.abs(lot.quantity) < 1e-10) {
      lots.splice(idx, 1);
    }
  }

  return realized;
}

export function calcWhatIf(input: {
  quantity: number;
  entryPrice: number;
  fees: number;
  targetPrice: number;
}): { pnl: number; pnlPct: number; costBasis: number } {
  const qty = input.quantity;
  const costBasis = Math.abs(qty) * input.entryPrice + Math.abs(input.fees);
  let pnl: number;
  if (qty >= 0) {
    pnl = qty * input.targetPrice - qty * input.entryPrice - Math.abs(input.fees);
  } else {
    const abs = Math.abs(qty);
    pnl = abs * input.entryPrice - abs * input.targetPrice - Math.abs(input.fees);
  }
  const pnlPct = costBasis !== 0 ? (pnl / costBasis) * 100 : 0;
  return { pnl, pnlPct, costBasis };
}
