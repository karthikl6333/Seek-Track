

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

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string | null;
  url: string;
}

export interface ChartPoint {
  date: string;
  [symbol: string]: string | number | null;
}
