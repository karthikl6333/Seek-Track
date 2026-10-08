import type {
  AppSettings,
  ImportResult,
  JournalEntry,
  ManualTradeInput,
  MarkInfo,
  PairDef,
  PairResolveResult,
  Trade,
} from '../types';
import { DEFAULT_SETTINGS } from './pairs';

// Build API base URL without credentials (avoid "Request cannot be constructed from a URL that includes credentials")
// If VITE_API_BASE is empty, use window.location.origin (strips credentials from page URL)
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 
  (typeof window !== 'undefined' ? window.location.origin : '');

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Build URL from API_BASE + path to avoid carrying credentials from page URL into fetch
  // If API_BASE is empty, just use path as-is (for relative URLs)
  // Otherwise, use new URL(path, base) which strips credentials from base
  const url = API_BASE ? new URL(path, API_BASE).href : path;
  
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401) {
      throw new AuthError('Authentication required. Please log in again.');
    }
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function loadAllTrades(): Promise<Trade[]> {
  return api<Trade[]>('/api/trades');
}

export async function getExistingHashes(): Promise<Set<string>> {
  const trades = await loadAllTrades();
  return new Set(trades.map((t) => t.rowHash));
}

/** Append-only import: skips rows whose rowHash already exists. Never wipes history. */
export async function appendTrades(trades: Trade[]): Promise<number> {
  if (!trades.length) return 0;
  const result = await api<ImportResult>('/api/trades', {
    method: 'POST',
    body: JSON.stringify(trades),
  });
  return result.added;
}

export async function importCsvText(
  csvText: string,
  overrideManual = true,
): Promise<ImportResult> {
  return api<ImportResult>('/api/import', {
    method: 'POST',
    body: JSON.stringify({ csvText, overrideManual }),
  });
}

export async function addManualTrade(input: ManualTradeInput): Promise<ImportResult & { trade?: Trade }> {
  return api('/api/trades', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateTradeNote(id: string, note: string): Promise<void> {
  await api(`/api/trades/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  });
}

export async function loadMarks(): Promise<Record<string, number>> {
  return api<Record<string, number>>('/api/marks');
}

export async function loadMarksDetailed(): Promise<{
  marks: Record<string, MarkInfo>;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
}> {
  return api('/api/marks?detailed=1');
}

export async function setMark(symbol: string, price: number): Promise<void> {
  await api('/api/marks', {
    method: 'PUT',
    body: JSON.stringify({ symbol: symbol.toUpperCase(), price }),
  });
}

export async function getQuoteUniverse(): Promise<{ symbols: string[]; total: number }> {
  return api('/api/quotes/universe');
}

export async function refreshQuotes(
  symbols?: string[]
): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  error?: string;
  refreshedAt: string;
  total: number;
  needsChunking?: boolean;
  universe?: string[];
  chunkSize?: number;
}> {
  const body: {
    symbols?: string[];
  } = {};
  if (symbols?.length) body.symbols = symbols;
  return api('/api/quotes/refresh', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function resolvePair(symbol: string): Promise<PairResolveResult> {
  return api(`/api/pairs/resolve?symbol=${encodeURIComponent(symbol)}`);
}

export async function listPairCache(): Promise<{ pairs: PairDef[]; note?: string }> {
  return api('/api/pairs');
}

export async function loadJournal(): Promise<JournalEntry[]> {
  return api<JournalEntry[]>('/api/journal');
}

export async function saveJournalEntry(entry: JournalEntry): Promise<void> {
  await api('/api/journal', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

export async function deleteJournalEntry(id: string): Promise<void> {
  await api(`/api/journal/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const data = await api<AppSettings>('/api/settings');
    if (!data?.pairs || !data?.themes) return structuredClone(DEFAULT_SETTINGS);
    return {
      ...data,
      hiddenSymbols: Array.isArray(data.hiddenSymbols)
        ? data.hiddenSymbols.map((s) => String(s).toUpperCase())
        : [],
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function loadPaperSummary(): Promise<import('../types').PaperSummary> {
  return api<import('../types').PaperSummary>('/api/paper');
}

export async function refreshPaperData(): Promise<{ ok: boolean; error?: string; refreshedAt?: string }> {
  return api<{ ok: boolean; error?: string; refreshedAt?: string }>('/api/paper/refresh', {
    method: 'POST',
  });
}

export async function loadCryptoPaperSummary(): Promise<import('../types').CryptoPaperSummary> {
  return api<import('../types').CryptoPaperSummary>('/api/crypto-paper');
}

export async function refreshCryptoPaperLivePnl(): Promise<{
  ok: boolean;
  refreshedAt?: string;
  equity?: number;
  cash?: number;
  positions?: number;
  error?: string;
}> {
  return api('/api/crypto-paper/refresh', {
    method: 'POST',
  });
}

export async function loadPaperFlexSummary(): Promise<import('../types').PaperFlexSummary> {
  return api<import('../types').PaperFlexSummary>('/api/paper-flex');
}

export async function refreshPaperFlexData(): Promise<{ ok: boolean; error?: string; refreshedAt?: string }> {
  return api<{ ok: boolean; error?: string; refreshedAt?: string }>('/api/paper-flex/refresh', {
    method: 'POST',
  });
}

export async function loadAlerts(): Promise<{ alerts: import('../types').PriceAlert[] }> {
  return api('/api/alerts');
}

export async function createAlert(input: {
  symbol: string;
  targetPrice: number;
  condition: 'above' | 'below';
}): Promise<{ alert: import('../types').PriceAlert }> {
  return api('/api/alerts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteAlert(id: string): Promise<{ ok: boolean }> {
  return api(`/api/alerts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * Load watchlist symbols from the API
 * Returns array of symbols (uppercase, trimmed, no empty/TEST)
 */
export async function loadWatchlistSymbols(): Promise<string[]> {
  const data = await api<{
    symbols?: string[];
    rows?: Array<{ symbol: string }>;
    lastRefreshAt?: string | null;
  } | null>('/api/watchlist');
  
  // Handle null/undefined response gracefully
  if (!data) return [];
  
  // Prefer symbols array, fallback to rows[].symbol for backwards compatibility
  const symbols = data.symbols ?? data.rows?.map((r) => r.symbol) ?? [];
  return symbols
    .map((s) => s.toUpperCase().trim())
    .filter((s) => s.length > 0 && s !== 'TEST');
}
