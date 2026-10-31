export interface UniverseRow {
  symbol: string;
  name: string;
  sortOrder: number;
  sectorNote: string;
}

export interface EtfMapRow {
  underlying: string;
  etf: string;
  direction: 'bull' | 'bear';
  factor: number;
  source: string;
  updatedAt: string;
}

export interface QuoteSnap {
  symbol: string;
  price: number | null;
  dayPct: number | null;
  updatedAt: string | null;
  source?: string;
}

export interface TableRow {
  underlying: string;
  name: string;
  sectorNote: string;
  bullEtf: string | null;
  bullFactor: number | null;
  bearEtf: string | null;
  bearFactor: number | null;
  bullEtfs: EtfMapRow[];
  bearEtfs: EtfMapRow[];
  underlyingPrice: number | null;
  bullPrice: number | null;
  bearPrice: number | null;
  underlyingDayPct: number | null;
  bullDayPct: number | null;
  bearDayPct: number | null;
  updated: string | null;
}

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string | null;
  url: string;
}

export interface ResearchSummary {
  universe: UniverseRow[];
  maps: EtfMapRow[];
  quotes: Record<string, QuoteSnap>;
  rows: TableRow[];
  lastRefreshAt: string | null;
}

export interface ResearchDetail {
  underlying: UniverseRow;
  maps: EtfMapRow[];
  bull: EtfMapRow | null;
  bear: EtfMapRow | null;
  quotes: Record<string, QuoteSnap>;
  row: TableRow;
  chartSymbols: string[];
  chart: Array<Record<string, string | number | null>>;
  news: NewsItem[];
  newsError: string | null;
  lastRefreshAt: string | null;
}
