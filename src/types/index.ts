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

export type ViewId = 'overview' | 'positions' | 'trades' | 'charges' | 'charts' | 'research' | 'paper' | 'cryptoPaper' | 'paperFlex';

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
  t0Equity: number;
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

export interface CryptoPaperState {
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

export interface NewsSignal {
  id: string;
  ticker: string | null;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  rationale: string;
  positionImpact: string;
  corroborationStatus: 'corroborated' | 'unconfirmed';
  corroborationLink: string | null;
  sourceCount: number;
  sourceIds: string;
  normalizedText: string;
  originalTexts: string[];
  createdAt: string;
  refreshedAt: string;
}

export interface NewsRefreshResult {
  status: 'ok' | 'unconfigured' | 'partial' | 'error';
  signals?: NewsSignal[];
  missing?: string[];
  degraded?: string[];
  error?: string;
  message?: string;
  refreshedAt: string;
  stats?: {
    xSignals: number;
    finnhubSignals: number;
    rssSignals: number;
    llmCalls: number;
    duplicatesRemoved: number;
  };
}
