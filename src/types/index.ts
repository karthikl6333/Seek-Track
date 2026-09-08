export type TradeAction =
  | 'Buy'
  | 'Sell'
  | 'Buy to Cover'
  | 'Sell Short'
  | 'Journal'
  | 'Other';

export interface Trade {
  id: string;
  rowHash: string;
  date: string;
  action: string;
  symbol: string;
  description: string;
  quantity: number;
  price: number;
  fees: number;
  amount: number;
  importedAt: string;
  note?: string;
  source?: string;
}

export interface OpenLot {
  id: string;
  symbol: string;
  quantity: number;
  costPerShare: number;
  feesAllocated: number;
  openDate: string;
  tradeId: string;
}

export interface SymbolPosition {
  symbol: string;
  theme: string;
  quantity: number;
  avgCost: number;
  costBasis: number;
  markPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  realizedPnl: number;
  openLots: OpenLot[];
}

export interface ThemeSummary {
  theme: string;
  realizedPnl: number;
  unrealizedPnl: number | null;
  costBasis: number;
  symbols: string[];
}

export interface PairDef {
  etf: string;
  underlying: string;
  factor: number;
  theme: string;
  optional?: boolean;
  source?: string;
  rawName?: string | null;
}

export interface ThemeDef {
  id: string;
  name: string;
  symbols: string[];
}

export interface MarkInfo {
  symbol: string;
  price: number;
  updatedAt: string;
  source: string;
}

export interface MarkPrice {
  symbol: string;
  price: number;
  updatedAt: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  symbol?: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface AppSettings {
  pairs: PairDef[];
  themes: ThemeDef[];
  /** Symbols hidden from holdings / overview totals (CSV noise). */
  hiddenSymbols: string[];
}

export interface ImportResult {
  added: number;
  skipped: number;
  errors: string[];
  overridden?: number;
  overrideManual?: boolean;
}

export type ViewId = 'overview' | 'pairs' | 'positions' | 'trades' | 'journal' | 'charges' | 'charts' | 'research' | 'paper';

export interface CalculatorState {
  symbol: string;
  quantity: number;
  entryPrice: number;
  fees: number;
  targetPrice: number;
}

export interface ManualTradeInput {
  symbol: string;
  action: string;
  quantity: number;
  price: number;
  fees: number;
  date: string;
  description?: string;
}

export interface PairResolveResult {
  pair: PairDef | null;
  as: 'etf' | 'underlying' | 'unknown';
  message?: string;
}

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
