import type { AppSettings, ImportResult, JournalEntry, Trade } from '../types';
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

export async function importCsvText(csvText: string): Promise<ImportResult> {
  return api<ImportResult>('/api/import', {
    method: 'POST',
    body: JSON.stringify({ csvText }),
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

export async function setMark(symbol: string, price: number): Promise<void> {
  await api('/api/marks', {
    method: 'PUT',
    body: JSON.stringify({ symbol: symbol.toUpperCase(), price }),
  });
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
    return data;
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
