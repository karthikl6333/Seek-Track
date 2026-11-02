/**
 * Import of identical partial fills end to end (importCsvHandler -> insertTradesIdempotent), against a
 * real SQLite engine (sql.js) behind a D1-shaped binding.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query, setD1Database } from '../db.js';
import { importCsvHandler } from './trades.js';
import { hashTradeRow } from '../core/hash.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(here, '..', 'schema-d1.sql'), 'utf8');

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let sqlite: Database;

function runOne(sql: string, params: unknown[]) {
  const stmt = sqlite.prepare(sql);
  try {
    stmt.bind(params as SqlValue[]);
    const results: Record<string, unknown>[] = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    return { results, meta: { changes: sqlite.getRowsModified() } };
  } finally {
    stmt.free();
  }
}

function makeFakeD1() {
  const prepare = (sql: string) => {
    const make = (params: unknown[]) => ({
      sql,
      params,
      bind: (...p: unknown[]) => make(p),
      all: async () => runOne(sql, params),
      run: async () => runOne(sql, params),
    });
    return make([]);
  };
  return {
    prepare,
    batch: async (stmts: Array<{ sql: string; params: unknown[] }>) => {
      sqlite.run('BEGIN');
      try {
        const out = stmts.map((s) => runOne(s.sql, s.params));
        sqlite.run('COMMIT');
        return out;
      } catch (e) {
        sqlite.run('ROLLBACK');
        throw e;
      }
    },
  };
}

const ctx = (body: unknown) =>
  ({ req: { json: async () => body }, json: (payload: unknown) => payload }) as any;

const H = 'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount';
const fill = '11/02/2026,Buy,SNDG,Buy SNDG,1000,4.08,0,-4080.00';
const part = '11/02/2026,Buy,SNDG,Buy SNDG,500,4.00,0,-2000.00';
const importText = (csvText: string) => importCsvHandler(ctx({ csvText })) as unknown as Promise<{ added: number; skipped: number; errors: string[] }>;

async function sndgRows() {
  const r = await query<{ quantity: number; row_hash: string }>(
    `SELECT quantity, row_hash FROM trades WHERE symbol = 'SNDG' ORDER BY row_hash`,
  );
  return r.rows;
}

beforeAll(async () => {
  SQL = await initSqlJs();
});
beforeEach(() => {
  sqlite = new SQL.Database();
  sqlite.exec(schemaSql);
  setD1Database(makeFakeD1() as any);
});
afterEach(() => sqlite.close());

describe('CSV import of identical fills', () => {
  it('(a) two identical rows in one file are stored as two trades and reported as added', async () => {
    const res = await importText([H, fill, fill, part].join('\n'));
    expect(res.added).toBe(3);
    expect((await sndgRows()).map((r) => Number(r.quantity)).sort((x, y) => x - y)).toEqual([500, 1000, 1000]);
  });

  it('(b) re-importing the same file adds 0', async () => {
    const csv = [H, fill, fill, part].join('\n');
    await importText(csv);
    const again = await importText(csv);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(3);
    expect(await sndgRows()).toHaveLength(3);
  });

  it('(c) a legacy single row in the DB plus a file with two identical rows adds exactly 1', async () => {
    // A row stored the old way: plain hash, no suffix.
    const legacyHash = hashTradeRow({ date: '11/02/2026', action: 'Buy', symbol: 'SNDG', description: 'Buy SNDG', quantity: 1000, price: 4.08, fees: 0, amount: -4080 });
    await query(
      `INSERT INTO trades (id, row_hash, date, action, symbol, description, quantity, price, fees, amount, imported_at, source)
       VALUES ('legacy', $1, '11/02/2026', 'Buy', 'SNDG', 'Buy SNDG', 1000, 4.08, 0, -4080, '2026-11-02T00:00:00Z', 'csv')`,
      [legacyHash],
    );
    const res = await importText([H, fill, fill].join('\n'));
    expect(res.added).toBe(1);
    const rows = await sndgRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.row_hash).sort()).toEqual([legacyHash, `${legacyHash}#2`].sort());
  });

  it('(d) unrelated rows import once and keep the plain hash; an overlapping later export adds only new rows', async () => {
    const day1 = [H, '10/15/2026,Buy,SNDG,Buy SNDG,1000,3.50,0,-3500.00', '10/26/2026,Sell,SNDG,Sell SNDG,1000,3.90,0,3900.00'];
    expect((await importText(day1.join('\n'))).added).toBe(2);
    const later = [...day1, fill, fill];
    const res = await importText(later.join('\n'));
    expect(res.added).toBe(2);
    expect((await sndgRows()).filter((r) => !r.row_hash.includes('#'))).toHaveLength(3);
    expect((await importText(later.join('\n'))).added).toBe(0);
  });
});
