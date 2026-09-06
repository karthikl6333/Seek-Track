import { randomUUID } from 'node:crypto';
import { hashTradeRow } from './hash.js';

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

export interface ImportResult {
  added: number;
  skipped: number;
  errors: string[];
}

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!cleaned || cleaned === '--') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result.map((s) => s.trim());
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface ParsedRow {
  date: string;
  action: string;
  symbol: string;
  description: string;
  quantity: string;
  price: string;
  fees: string;
  amount: string;
}

const HEADER_MAP: Record<string, keyof ParsedRow> = {
  date: 'date',
  action: 'action',
  symbol: 'symbol',
  description: 'description',
  quantity: 'quantity',
  qty: 'quantity',
  price: 'price',
  'fees & comm': 'fees',
  'fees&comm': 'fees',
  fees: 'fees',
  commission: 'fees',
  amount: 'amount',
};

export function parseSchwabCsv(
  text: string,
  existingHashes: Set<string>,
): { trades: Trade[]; result: ImportResult } {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const errors: string[] = [];
  if (lines.length === 0) {
    return { trades: [], result: { added: 0, skipped: 0, errors: ['Empty file'] } };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const idx: Partial<Record<keyof ParsedRow, number>> = {};
  headers.forEach((h, i) => {
    const key = HEADER_MAP[h];
    if (key) idx[key] = i;
  });

  const required: (keyof ParsedRow)[] = ['date', 'action', 'symbol', 'quantity', 'price'];
  for (const r of required) {
    if (idx[r] === undefined) {
      errors.push(`Missing required column: ${r}`);
    }
  }
  if (errors.length) {
    return { trades: [], result: { added: 0, skipped: 0, errors } };
  }

  const trades: Trade[] = [];
  let skipped = 0;
  const now = new Date().toISOString();

  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    if (cols.every((c) => !c)) continue;

    const get = (k: keyof ParsedRow) => {
      const i = idx[k];
      return i === undefined ? '' : (cols[i] ?? '');
    };

    const date = get('date');
    const action = get('action');
    const symbol = get('symbol').toUpperCase();
    const description = get('description');
    const quantity = parseNumber(get('quantity'));
    const price = parseNumber(get('price'));
    const fees = parseNumber(get('fees'));
    let amount = parseNumber(get('amount'));
    if (!get('amount') || amount === 0) {
      const signedQty = /sell/i.test(action) ? -Math.abs(quantity) : Math.abs(quantity);
      amount = -(signedQty * price) - fees;
    }

    if (!symbol && !action) {
      skipped++;
      continue;
    }

    const rowHash = hashTradeRow({
      date,
      action,
      symbol,
      description,
      quantity,
      price,
      fees,
      amount,
    });

    if (existingHashes.has(rowHash)) {
      skipped++;
      continue;
    }
    existingHashes.add(rowHash);

    trades.push({
      id: randomUUID(),
      rowHash,
      date,
      action,
      symbol,
      description,
      quantity: Math.abs(quantity),
      price,
      fees: Math.abs(fees),
      amount,
      importedAt: now,
    });
  }

  return {
    trades,
    result: { added: trades.length, skipped, errors },
  };
}
