/**
 * Concurrency tests for the paper / crypto-paper / paper-flex position refresh, run against a
 * REAL SQLite engine (sql.js) behind a D1-shaped binding:
 *  - every prepared statement auto-commits (like D1),
 *  - db.batch() runs all statements in one transaction (like D1),
 *  - every call yields to the event loop first, so concurrent requests interleave per statement.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { query, setD1Database } from './db.js';
import { refreshPaperFromAlpaca } from './paper.js';
import { refreshCryptoPaperLivePnl } from './crypto-paper.js';
import { refreshPaperFlexFromAlpaca, upsertPaperFlexPositions } from './paper-flex.js';
import {
  buildReplacePositionsStatements,
  MAX_POSITIONS,
  replacePositions,
} from './positions-sync.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(here, 'schema-d1.sql'), 'utf8');

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let sqlite: Database;

const tick = () => new Promise<void>((r) => setImmediate(r));

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
      all: async () => {
        await tick();
        return runOne(sql, params);
      },
      run: async () => {
        await tick();
        return runOne(sql, params);
      },
    });
    return make([]);
  };
  return {
    prepare,
    batch: async (stmts: Array<{ sql: string; params: unknown[] }>) => {
      await tick();
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

/** Minimal Hono-like context. */
function ctx(body?: unknown) {
  return {
    req: { json: async () => body },
    json: (payload: unknown, status = 200) => ({ payload, status }),
  } as any;
}

function alpacaFetch(positions: Array<Record<string, unknown>>) {
  return vi.fn(async (url: string) => {
    const body = String(url).endsWith('/v2/account')
      ? { equity: '100000', cash: '50000', buying_power: '100000', last_equity: '99000' }
      : positions;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

const pos = (symbol: string, qty: string, side = 'long', extra: Record<string, unknown> = {}) => ({
  symbol,
  qty,
  side,
  avg_entry_price: '10',
  market_value: '100',
  unrealized_pl: '1',
  asset_class: 'us_equity',
  ...extra,
});

async function rows(table: string) {
  const r = await query<{ symbol: string; quantity: number; theme: string }>(
    `SELECT symbol, quantity, theme FROM ${table} ORDER BY symbol`,
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
  process.env.ALPACA_API_KEY = 'k';
  process.env.ALPACA_SECRET_KEY = 's';
  process.env.ALPACA_CRYPTO_API_KEY = 'k';
  process.env.ALPACA_CRYPTO_SECRET_KEY = 's';
  process.env.ALPACA_FLEX_API_KEY = 'k';
  process.env.ALPACA_FLEX_SECRET_KEY = 's';
});

afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

describe('legacy DELETE-then-INSERT (regression evidence)', () => {
  it('two concurrent runs hit the paper_positions primary key on D1-style auto-commit', async () => {
    const legacy = async () => {
      await query(`DELETE FROM paper_positions`);
      for (const s of ['NVDL', 'TSLL']) {
        await query(
          `INSERT INTO paper_positions (symbol, quantity, avg_price, market_value, unrealized_pnl, theme, updated_at)
           VALUES ($1, 1, 1, 1, 1, '', NOW())`,
          [s],
        );
      }
    };
    const results = await Promise.allSettled([legacy(), legacy()]);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.length).toBeGreaterThan(0);
    expect(String(rejected[0].reason)).toMatch(/UNIQUE constraint failed: paper_positions\.symbol/);
  });
});

describe('concurrent Alpaca refreshes are safe and idempotent', () => {
  it('paper: two simultaneous refreshes both succeed and leave exactly one row per symbol', async () => {
    vi.stubGlobal('fetch', alpacaFetch([pos('NVDL', '100'), pos('TSLL', '50'), pos('SOXS', '20', 'short')]));
    const [a, b] = await Promise.all([refreshPaperFromAlpaca(ctx()), refreshPaperFromAlpaca(ctx())]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await rows('paper_positions')).toEqual([
      { symbol: 'NVDL', quantity: 100, theme: '' },
      // same sign convention as before: qty * -1 for side=short
      { symbol: 'SOXS', quantity: -20, theme: '' },
      { symbol: 'TSLL', quantity: 50, theme: '' },
    ]);
  });

  it('paper: five concurrent refreshes with changing holdings converge to one consistent set', async () => {
    let call = 0;
    const sets = [
      [pos('NVDL', '100'), pos('TSLL', '50')],
      [pos('NVDL', '110')],
      [pos('NVDL', '120'), pos('AMDL', '5')],
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/v2/account')) {
          return new Response(JSON.stringify({ equity: '1', cash: '1', buying_power: '1' }), { status: 200 });
        }
        const body = sets[call++ % sets.length];
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const res = await Promise.all(Array.from({ length: 5 }, () => refreshPaperFromAlpaca(ctx())));
    expect(res.every((r) => r.status === 200)).toBe(true);
    const final = await rows('paper_positions');
    const symbols = final.map((r) => r.symbol);
    expect(new Set(symbols).size).toBe(symbols.length); // no duplicates
    // The final table equals exactly one of the snapshots (whichever batch committed last).
    const asKey = (xs: string[]) => [...xs].sort().join(',');
    expect(sets.map((s) => asKey(s.map((p) => p.symbol as string)))).toContain(asKey(symbols));
  });

  it('paper: keeps a user-set theme across refreshes and removes symbols no longer held', async () => {
    await query(
      `INSERT INTO paper_positions (symbol, quantity, avg_price, theme, updated_at)
       VALUES ('NVDL', 1, 1, 'Semis', NOW()), ('GONE', 1, 1, 'Old', NOW())`,
    );
    vi.stubGlobal('fetch', alpacaFetch([pos('NVDL', '100')]));
    await Promise.all([refreshPaperFromAlpaca(ctx()), refreshPaperFromAlpaca(ctx())]);
    expect(await rows('paper_positions')).toEqual([{ symbol: 'NVDL', quantity: 100, theme: 'Semis' }]);
  });

  it('crypto-paper: concurrent refreshes succeed (was 500 on D1)', async () => {
    vi.stubGlobal(
      'fetch',
      alpacaFetch([pos('BTCUSD', '0.5', 'long', { asset_class: 'crypto' }), pos('ETHUSD', '2', 'long', { asset_class: 'crypto' })]),
    );
    const res = await Promise.all([refreshCryptoPaperLivePnl(ctx()), refreshCryptoPaperLivePnl(ctx())]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    expect(await rows('crypto_paper_positions')).toEqual([
      { symbol: 'BTCUSD', quantity: 0.5, theme: 'Crypto' },
      { symbol: 'ETHUSD', quantity: 2, theme: 'Crypto' },
    ]);
  });

  it('paper-flex: concurrent refreshes + manual upsert succeed', async () => {
    vi.stubGlobal('fetch', alpacaFetch([pos('NVDL', '10'), pos('TSLL', '5')]));
    const res = await Promise.all([
      refreshPaperFlexFromAlpaca(ctx()),
      refreshPaperFlexFromAlpaca(ctx()),
      upsertPaperFlexPositions(ctx({ positions: [{ symbol: 'NVDL', quantity: 10, avgPrice: 10, theme: 'Semis' }] })),
    ]);
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    const final = await rows('paper_flex_positions');
    expect(new Set(final.map((r) => r.symbol)).size).toBe(final.length);
  });

  it('an empty position list clears the table', async () => {
    await replacePositions('paper_positions', [
      { symbol: 'A', quantity: 1, avgPrice: 1, marketValue: null, unrealizedPnl: null, theme: '' },
    ]);
    await replacePositions('paper_positions', []);
    expect(await rows('paper_positions')).toEqual([]);
  });
});

describe('buildReplacePositionsStatements limits', () => {
  it('stays under 100 bound params per statement and 50 statements per batch', () => {
    const many = Array.from({ length: MAX_POSITIONS }, (_, i) => ({
      symbol: `S${i}`,
      quantity: 1,
      avgPrice: 1,
      marketValue: 1,
      unrealizedPnl: 1,
      theme: '',
    }));
    const stmts = buildReplacePositionsStatements('paper_positions', many);
    expect(stmts.length).toBeLessThanOrEqual(50);
    for (const s of stmts) expect((s.params ?? []).length).toBeLessThanOrEqual(100);
    expect(() => buildReplacePositionsStatements('paper_positions', [...many, { ...many[0], symbol: 'X' }])).toThrow(
      /Too many positions/,
    );
  });

  it('de-duplicates symbols and drops rows without a finite quantity', () => {
    const stmts = buildReplacePositionsStatements('paper_positions', [
      { symbol: 'A', quantity: 1, avgPrice: 1, marketValue: null, unrealizedPnl: null, theme: '' },
      { symbol: 'A', quantity: 2, avgPrice: 1, marketValue: Number.NaN, unrealizedPnl: null, theme: '' },
      { symbol: 'B', quantity: Number.NaN, avgPrice: 1, marketValue: null, unrealizedPnl: null, theme: '' },
    ]);
    expect(stmts[0].params).toEqual(['A', 2, 1, null, null, '']);
    expect(stmts[1].params).toEqual([['A']]);
  });
});
