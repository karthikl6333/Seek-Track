import type {
  AppSettings,
  ImportResult,
  JournalEntry,
  ManualTradeInput,
  MarkInfo,
  PairDef,
  PairResolveResult,
  Trade,
} from '../types/index';
import { DEFAULT_SETTINGS } from '../lib/pairs';

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

/**
 * Trades list. The server caches it per isolate; pass `fresh` right after this client wrote trades
 * (import / manual fill / note) so a cached copy in another isolate can't hide the change.
 */
export async function loadAllTrades(opts?: { fresh?: boolean }): Promise<Trade[]> {
  return api<Trade[]>(opts?.fresh ? '/api/trades?fresh=1' : '/api/trades');
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

/**
 * Detailed marks. With `since` (the newest updatedAt this client already has) the server returns
 * only rows changed after it (indexed delta, `incremental: true`); the store MERGES either way.
 */
export async function loadMarksDetailed(since?: string | null): Promise<{
  marks: Record<string, MarkInfo>;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  incremental?: boolean;
}> {
  return api(since ? `/api/marks?detailed=1&since=${encodeURIComponent(since)}` : '/api/marks?detailed=1');
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
  stale?: string[];
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

/** `?fresh=1` asks the server to skip its per-isolate read cache (use right after own writes). */
const freshQs = (fresh?: boolean, sep: '?' | '&' = '?') => (fresh ? `${sep}fresh=1` : '');

export async function listPairCache(opts?: { fresh?: boolean }): Promise<{ pairs: PairDef[]; note?: string }> {
  return api(`/api/pairs${freshQs(opts?.fresh)}`);
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

export async function loadSettings(opts?: { fresh?: boolean }): Promise<AppSettings> {
  try {
    const data = await api<AppSettings>(`/api/settings${freshQs(opts?.fresh)}`);
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

export async function loadPaperSummary(opts?: { fresh?: boolean }): Promise<import('../types/index').PaperSummary> {
  return api<import('../types/index').PaperSummary>(`/api/paper${freshQs(opts?.fresh)}`);
}

export async function refreshPaperData(): Promise<{ ok: boolean; error?: string; refreshedAt?: string }> {
  return api<{ ok: boolean; error?: string; refreshedAt?: string }>('/api/paper/refresh', {
    method: 'POST',
  });
}

export async function loadCryptoPaperSummary(opts?: { fresh?: boolean }): Promise<import('../types/index').CryptoPaperSummary> {
  return api<import('../types/index').CryptoPaperSummary>(`/api/crypto-paper${freshQs(opts?.fresh)}`);
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

export async function loadPaperFlexSummary(opts?: { fresh?: boolean }): Promise<import('../types/index').PaperFlexSummary> {
  return api<import('../types/index').PaperFlexSummary>(`/api/paper-flex${freshQs(opts?.fresh)}`);
}

export async function refreshPaperFlexData(): Promise<{ ok: boolean; error?: string; refreshedAt?: string }> {
  return api<{ ok: boolean; error?: string; refreshedAt?: string }>('/api/paper-flex/refresh', {
    method: 'POST',
  });
}

export async function loadAlerts(): Promise<{ alerts: import('../types/index').PriceAlert[] }> {
  return api('/api/alerts');
}

export async function createAlert(input: {
  symbol: string;
  targetPrice: number;
  condition: 'above' | 'below';
}): Promise<{ alert: import('../types/index').PriceAlert }> {
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

export async function loadPlanRules(account?: import('../types/index').PlanRuleAccount): Promise<{ rules: import('../types/index').PlanRule[] }> {
  const qs = account ? `?account=${encodeURIComponent(account)}` : '';
  return api(`/api/plan-rules${qs}`);
}

export async function createPlanRule(input: {
  symbol: string;
  account?: import('../types/index').PlanRuleAccount;
  ruleType: import('../types/index').PlanRuleType;
  priceLevel?: number | null;
  deadlineDate?: string | null;
  note?: string | null;
}): Promise<{ rule: import('../types/index').PlanRule }> {
  return api('/api/plan-rules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updatePlanRule(
  id: string,
  updates: {
    priceLevel?: number | null;
    deadlineDate?: string | null;
    note?: string | null;
    active?: boolean;
  },
): Promise<{ ok: boolean }> {
  return api(`/api/plan-rules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deletePlanRule(id: string): Promise<{ ok: boolean }> {
  return api(`/api/plan-rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
