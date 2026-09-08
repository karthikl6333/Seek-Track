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

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
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

export async function refreshQuotes(symbols?: string[]): Promise<{
  ok: boolean;
  updated: string[];
  failed: string[];
  error?: string;
  refreshedAt: string;
}> {
  return api('/api/quotes/refresh', {
    method: 'POST',
    body: JSON.stringify(symbols?.length ? { symbols } : {}),
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
