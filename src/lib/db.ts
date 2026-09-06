import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppSettings, JournalEntry, MarkPrice, Trade } from '../types';
import { DEFAULT_SETTINGS } from './pairs';

interface SeekTrackDB extends DBSchema {
  trades: {
    key: string;
    value: Trade;
    indexes: { 'by-hash': string; 'by-symbol': string; 'by-date': string };
  };
  marks: {
    key: string;
    value: MarkPrice;
  };
  journal: {
    key: string;
    value: JournalEntry;
    indexes: { 'by-date': string };
  };
  settings: {
    key: string;
    value: AppSettings & { id: string };
  };
}

const DB_NAME = 'seek-track';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SeekTrackDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<SeekTrackDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const trades = db.createObjectStore('trades', { keyPath: 'id' });
        trades.createIndex('by-hash', 'rowHash', { unique: true });
        trades.createIndex('by-symbol', 'symbol');
        trades.createIndex('by-date', 'date');

        db.createObjectStore('marks', { keyPath: 'symbol' });

        const journal = db.createObjectStore('journal', { keyPath: 'id' });
        journal.createIndex('by-date', 'date');

        db.createObjectStore('settings', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function loadAllTrades(): Promise<Trade[]> {
  const db = await getDb();
  return db.getAll('trades');
}

export async function getExistingHashes(): Promise<Set<string>> {
  const trades = await loadAllTrades();
  return new Set(trades.map((t) => t.rowHash));
}

/** Append-only import: skips rows whose rowHash already exists. Never wipes history. */
export async function appendTrades(trades: Trade[]): Promise<number> {
  if (!trades.length) return 0;
  const db = await getDb();
  const tx = db.transaction('trades', 'readwrite');
  let added = 0;
  for (const t of trades) {
    const existing = await tx.store.index('by-hash').get(t.rowHash);
    if (existing) continue;
    await tx.store.add(t);
    added++;
  }
  await tx.done;
  return added;
}

export async function updateTradeNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  const trade = await db.get('trades', id);
  if (!trade) return;
  trade.note = note;
  await db.put('trades', trade);
}

export async function loadMarks(): Promise<Record<string, number>> {
  const db = await getDb();
  const all = await db.getAll('marks');
  const out: Record<string, number> = {};
  for (const m of all) out[m.symbol] = m.price;
  return out;
}

export async function setMark(symbol: string, price: number): Promise<void> {
  const db = await getDb();
  await db.put('marks', {
    symbol: symbol.toUpperCase(),
    price,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadJournal(): Promise<JournalEntry[]> {
  const db = await getDb();
  const all = await db.getAll('journal');
  return all.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function saveJournalEntry(entry: JournalEntry): Promise<void> {
  const db = await getDb();
  await db.put('journal', entry);
}

export async function deleteJournalEntry(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('journal', id);
}

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const row = await db.get('settings', 'default');
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const { id: _id, ...rest } = row;
  return rest;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  await db.put('settings', { ...settings, id: 'default' });
}
