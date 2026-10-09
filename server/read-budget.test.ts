/**
 * D1 read-budget tests: per-isolate cache TTL/invalidation, SQL read-cache rules, the indexed
 * delta cursor (overlap + dedupe) against a real SQLite engine, the schema v2 gate, and the
 * per-route rows_read accounting.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetIsolateCacheForTests,
  __setCacheClockForTests,
  cached,
  cacheStats,
  noteWriteSql,
  writtenTables,
} from './isolate-cache.js';
import { query, readCacheRuleFor, setD1Database } from './db.js';
import { __resetSchemaStateForTests, convertQueryForD1, ensureSchema, SCHEMA_VERSION } from './db-d1.js';
import {
  createDeltaCursor,
  cursorWithLookback,
  dedupeDelta,
  INCREMENTAL_OVERLAP_MS,
  listMarksDetailed,
  listMarksDetailedIncremental,
  parseSinceCursor,
  pruneSent,
  type MarkInfo,
} from './quotes.js';
import {
  __resetReadBudgetForTests,
  formatSummary,
  readBudgetSnapshot,
  routeKey,
  withRequestBudget,
} from './read-budget.js';
import { STREAM_TICK_MS, streamTickMs } from './quote-stream.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(here, 'schema-d1.sql'), 'utf8');

// ---------------------------------------------------------------------------------------------
// D1-shaped binding over sql.js (auto-commit per statement, batch = one transaction).
// meta.rows_read is approximated with SQLite's VM step counter of fullscan/sort; we expose the
// number of rows returned plus `scanned` from EXPLAIN-free counting via sqlite_stmt? Not available
// in sql.js, so tests that care about index use assert on EXPLAIN QUERY PLAN instead.
// ---------------------------------------------------------------------------------------------
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let sqlite: Database;
const executed: string[] = [];

function runOne(sql: string, params: unknown[]) {
  executed.push(sql);
  const stmt = sqlite.prepare(sql);
  try {
    stmt.bind(params as SqlValue[]);
    const results: Record<string, unknown>[] = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    return { results, meta: { changes: sqlite.getRowsModified(), rows_read: results.length, rows_written: 0 } };
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

function planFor(sql: string, params: unknown[] = []): string {
  const conv = convertQueryForD1(sql, params);
  const res = sqlite.exec(`EXPLAIN QUERY PLAN ${conv.sql}`, conv.params as SqlValue[]);
  return (res[0]?.values ?? []).map((r) => String(r[3])).join(' | ');
}

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(async () => {
  sqlite = new SQL.Database();
  executed.length = 0;
  __resetIsolateCacheForTests();
  __resetSchemaStateForTests();
  __resetReadBudgetForTests();
  setD1Database(makeFakeD1() as never);
  await ensureSchema();
  executed.length = 0;
});

afterEach(() => {
  sqlite.close();
});

// ---------------------------------------------------------------------------------------------
describe('isolate cache: TTL and invalidation', () => {
  it('serves from cache within the TTL and reloads after it', async () => {
    let now = 1_000;
    __setCacheClockForTests(() => now);
    let loads = 0;
    const load = () => cached('k', { ttlMs: 15_000, tables: ['marks'] }, async () => ++loads);
    expect(await load()).toBe(1);
    now += 14_999;
    expect(await load()).toBe(1);
    now += 2;
    expect(await load()).toBe(2);
  });

  it('a write to a dependent table in this isolate drops the entry; other tables do not', async () => {
    let loads = 0;
    const load = () => cached('w', { ttlMs: 60_000, tables: ['watchlist', 'marks'] }, async () => ++loads);
    await load();
    noteWriteSql('INSERT INTO trades (id) VALUES ($1)');
    expect(await load()).toBe(1);
    noteWriteSql(`INSERT INTO marks (symbol, price, updated_at) VALUES ($1, $2, NOW())
                  ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price`);
    expect(await load()).toBe(2);
    noteWriteSql('DELETE FROM watchlist WHERE symbol = $1');
    expect(await load()).toBe(3);
  });

  it('concurrent callers share one in-flight load', async () => {
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const load = () =>
      cached('c', { ttlMs: 60_000, tables: ['t'] }, async () => {
        loads++;
        await gate;
        return 'v';
      });
    const all = Promise.all([load(), load(), load()]);
    release();
    expect(await all).toEqual(['v', 'v', 'v']);
    expect(loads).toBe(1);
  });

  it('a load that was in flight during a write is returned but NOT cached', async () => {
    let n = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = cached('r', { ttlMs: 60_000, tables: ['marks'] }, async () => {
      n++;
      await gate;
      return 'stale';
    });
    noteWriteSql('UPDATE marks SET price = 1 WHERE symbol = $1');
    release();
    expect(await first).toBe('stale');
    expect(await cached('r', { ttlMs: 60_000, tables: ['marks'] }, async () => (n++, 'fresh'))).toBe('fresh');
  });

  it('?fresh=1 requests bypass (and refill) the cache', async () => {
    let loads = 0;
    const load = () => cached('b', { ttlMs: 60_000, tables: ['t'] }, async () => ++loads);
    await load();
    expect(await withRequestBudget('GET /x', () => load(), { bypassCache: true })).toBe(2);
    expect(await load()).toBe(2);
  });

  it('writtenTables recognises every write form used by the server', () => {
    expect(writtenTables('SELECT * FROM marks')).toEqual([]);
    expect(writtenTables('INSERT OR REPLACE INTO schema_meta (id) VALUES (1)')).toEqual(['schema_meta']);
    expect(writtenTables('UPDATE trades SET note = $1 WHERE id = $2 RETURNING id')).toEqual(['trades']);
    expect(writtenTables('DELETE FROM paper_positions WHERE NOT (symbol = ANY($1))')).toEqual(['paper_positions']);
    expect(writtenTables('CREATE INDEX IF NOT EXISTS x ON marks (updated_at)')).toEqual(['*']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('db.ts read-cache rules', () => {
  it('caches the hot single-table reads', () => {
    expect(readCacheRuleFor('SELECT data FROM settings WHERE id = 1')).toEqual({ ttlMs: 30_000, table: 'settings' });
    expect(readCacheRuleFor('SELECT * FROM pair_cache ORDER BY etf')?.table).toBe('pair_cache');
    expect(readCacheRuleFor('SELECT * FROM research_etf_map ORDER BY underlying, direction')?.table).toBe('research_etf_map');
    expect(readCacheRuleFor('SELECT * FROM trades ORDER BY date DESC, imported_at DESC')).toEqual({ ttlMs: 300_000, table: 'trades' });
    expect(readCacheRuleFor('SELECT * FROM crypto_paper_orders ORDER BY created_at DESC LIMIT 20')?.table).toBe('crypto_paper_orders');
    expect(readCacheRuleFor('SELECT * FROM paper_flex_state WHERE id = 1')?.table).toBe('paper_flex_state');
  });

  it('never caches writes, joins/unions, or reads that must be exact', () => {
    expect(readCacheRuleFor('SELECT row_hash FROM trades')).toBeNull(); // import dedupe
    expect(readCacheRuleFor('SELECT symbol, price FROM marks WHERE symbol = ANY($1)')).toBeNull();
    expect(readCacheRuleFor("DELETE FROM pair_cache WHERE etf = $1")).toBeNull();
    expect(readCacheRuleFor('SELECT etf AS symbol FROM pair_cache UNION SELECT underlying FROM pair_cache')).toBeNull();
  });

  it('settings: second read is served from cache until a settings write', async () => {
    await query(`INSERT INTO settings (id, data) VALUES (1, '{"a":1}') ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`);
    executed.length = 0;
    await query('SELECT data FROM settings WHERE id = 1');
    await query('SELECT data FROM settings WHERE id = 1');
    expect(executed.filter((s) => s.includes('FROM settings')).length).toBe(1);
    await query(`UPDATE settings SET data = '{"a":2}' WHERE id = 1`);
    const r = await query<{ data: string }>('SELECT data FROM settings WHERE id = 1');
    expect(JSON.parse(r.rows[0].data)).toEqual({ a: 2 });
  });
});

// ---------------------------------------------------------------------------------------------
describe('marks delta cursor (index seek, tiny overlap, dedupe)', () => {
  it('schema v2 has marks_updated_at_idx and the delta read uses it (no table scan)', () => {
    const plan = planFor('SELECT symbol FROM marks WHERE updated_at > $1 ORDER BY updated_at', ['2026-10-09T00:00:00.000Z']);
    expect(plan).toMatch(/USING INDEX marks_updated_at_idx/);
    expect(plan).not.toMatch(/^SCAN marks$/);
    expect(planFor("SELECT id FROM price_alerts WHERE status = 'active' AND symbol = ANY($1)", [['AAPL']])).toMatch(
      /price_alerts_status_symbol_idx/,
    );
  });

  it('overlap is 2s (was a 15s look-back that re-read whole windows)', () => {
    expect(INCREMENTAL_OVERLAP_MS).toBe(2_000);
    expect(cursorWithLookback('2026-10-09T10:00:05.000Z')).toBe('2026-10-09T10:00:03.000Z');
  });

  it('dedupeDelta drops rows already delivered and keeps genuinely new ones', () => {
    const sent = new Map<string, string>([['AAPL', '2026-10-09T10:00:00.000Z']]);
    const m = (symbol: string, updatedAt: string): MarkInfo => ({ symbol, price: 1, updatedAt, source: 'yahoo', dayPct: null });
    const out = dedupeDelta(sent, {
      AAPL: m('AAPL', '2026-10-09T10:00:00.000Z'), // overlap re-read
      GOOG: m('GOOG', '2026-10-09T10:00:01.000Z'), // new
    });
    expect(Object.keys(out)).toEqual(['GOOG']);
    expect(dedupeDelta(sent, { AAPL: m('AAPL', '2026-10-09T10:00:02.000Z') })).toHaveProperty('AAPL');
    pruneSent(sent, '2026-10-09T10:10:00.000Z');
    expect(sent.size).toBe(0);
  });

  it('end-to-end on SQLite: ticks read only changed rows, never miss a write, never duplicate', async () => {
    // 100 marks with spread-out old stamps (like prod).
    for (let i = 0; i < 100; i++) {
      await query(`INSERT INTO marks (symbol, price, updated_at, source) VALUES ($1, $2, $3, 'yahoo')`, [
        `S${i}`,
        10 + i,
        new Date(Date.parse('2026-10-09T09:00:00.000Z') + i * 60_000).toISOString(),
      ]);
    }
    const snap = await listMarksDetailed();
    const cur = createDeltaCursor(snap.lastRefreshAt);
    const sent = new Map(Object.values(snap.marks).map((m) => [m.symbol, m.updatedAt]));
    const delivered: string[] = [];
    const tick = async () => {
      const d = await listMarksDetailedIncremental(cur.value!, cur.overlapMs());
      cur.advance(d.lastRefreshAt);
      delivered.push(...Object.keys(dedupeDelta(sent, d.marks)));
      return Object.keys(d.marks).length; // rows returned by the delta query
    };

    expect(await tick()).toBeLessThanOrEqual(1); // first tick: overlap re-reads at most the newest row
    expect(await tick()).toBe(0); // quiet tick: strict cursor, 0 rows
    expect(await tick()).toBe(0);

    // A refresh writes 3 changed rows with DB-side stamps (NOW()).
    for (const s of ['S1', 'S2', 'S3']) {
      await query(`UPDATE marks SET price = price + 1, updated_at = NOW() WHERE symbol = $1`, [s]);
    }
    expect(await tick()).toBe(3);
    expect([...delivered].sort()).toEqual(['S1', 'S2', 'S3']);

    // A late writer whose stamp is slightly older than the cursor (within the overlap) is caught
    // by the one overlapped read after the cursor moved...
    const late = new Date(Date.parse(cur.value!) - 500).toISOString();
    await query(`UPDATE marks SET price = 99, updated_at = $2 WHERE symbol = $1`, ['S50', late]);
    expect(await tick()).toBeLessThanOrEqual(10);
    expect(delivered).toContain('S50');
    // ...and nothing is delivered twice; afterwards quiet ticks read 0 rows again.
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(await tick()).toBe(0);
  });

  it('parseSinceCursor accepts ISO cursors and rejects garbage / far-future values', () => {
    const now = Date.parse('2026-10-09T10:00:00.000Z');
    expect(parseSinceCursor('2026-10-09T09:59:00.123Z', now)).toBe('2026-10-09T09:59:00.123Z');
    expect(parseSinceCursor('nope', now)).toBeNull();
    expect(parseSinceCursor('2030-01-01T00:00:00Z', now)).toBeNull();
    expect(parseSinceCursor(undefined, now)).toBeNull();
  });

  it('full marks list is cached per isolate and invalidated by a marks write', async () => {
    await query(`INSERT INTO marks (symbol, price, updated_at, source) VALUES ('AAA', 1, NOW(), 'yahoo')`);
    executed.length = 0;
    await listMarksDetailed();
    await listMarksDetailed();
    expect(executed.filter((s) => s.includes('FROM marks ORDER BY symbol')).length).toBe(1);
    await query(`UPDATE marks SET price = 2 WHERE symbol = 'AAA'`);
    expect((await listMarksDetailed()).marks.AAA.price).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
describe('schema v2 gate', () => {
  it('is version 2', () => {
    expect(SCHEMA_VERSION).toBe(2);
  });

  it('an existing v1 DB gets the new indexes once, then the version check short-circuits', async () => {
    // Simulate prod: v1 schema without the new indexes.
    sqlite.run('DROP INDEX marks_updated_at_idx');
    sqlite.run('DROP INDEX price_alerts_status_symbol_idx');
    sqlite.run('DROP INDEX pair_cache_underlying_idx');
    sqlite.run('UPDATE schema_meta SET version = 1 WHERE id = 1');
    __resetSchemaStateForTests();
    executed.length = 0;

    await ensureSchema();
    const idx = sqlite.exec("SELECT name FROM sqlite_master WHERE type = 'index'")[0].values.flat();
    expect(idx).toEqual(expect.arrayContaining(['marks_updated_at_idx', 'price_alerts_status_symbol_idx', 'pair_cache_underlying_idx']));
    expect(sqlite.exec('SELECT version FROM schema_meta')[0].values[0][0]).toBe(2);
    expect(executed.some((s) => /CREATE INDEX IF NOT EXISTS marks_updated_at_idx/.test(s))).toBe(true);

    // Same isolate: no further reads at all.
    executed.length = 0;
    await ensureSchema();
    expect(executed).toEqual([]);

    // New isolate on a v2 DB: one cheap version read, no DDL.
    __resetSchemaStateForTests();
    await ensureSchema();
    expect(executed).toEqual(['SELECT version FROM schema_meta WHERE id = 1']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('read-budget accounting', () => {
  it('attributes queries and rows_read to the route, and summarises', async () => {
    await query(`INSERT INTO marks (symbol, price, updated_at, source) VALUES ('AAA', 1, NOW(), 'yahoo'), ('BBB', 2, NOW(), 'yahoo')`);
    __resetReadBudgetForTests();
    __resetIsolateCacheForTests();
    const budget = await withRequestBudget(routeKey('GET', '/api/marks'), async (b) => {
      await listMarksDetailed();
      return b;
    });
    expect(budget).toMatchObject({ route: 'GET /api/marks', queries: 1, rowsRead: 2 });
    expect(readBudgetSnapshot()['GET /api/marks']).toMatchObject({ requests: 1, queries: 1, rowsRead: 2 });
    expect(formatSummary()).toMatch(/\[ReadBudget\] 1 req .* GET \/api\/marks n=1 q=1 read=2/);
  });

  it('routeKey collapses ids/symbols', () => {
    expect(routeKey('delete', '/api/watchlist/AAPL')).toBe('DELETE /api/watchlist/:id');
    expect(routeKey('GET', '/api/quotes/stream?since=x')).toBe('GET /api/quotes/stream');
    expect(routeKey('PATCH', '/api/trades/1b2c')).toBe('PATCH /api/trades/:id');
  });
});

describe('SSE tick cadence', () => {
  it('is session-aware: 5s regular, 15s pre/after, 60s overnight, 5 min weekend/holiday', () => {
    expect(STREAM_TICK_MS).toEqual({ regular: 5_000, premarket: 15_000, afterhours: 15_000, closed: 60_000, nontrading: 300_000 });
    expect(streamTickMs(new Date('2026-10-08T15:00:00Z'))).toBe(5_000); // Thu 11:00 ET
    expect(streamTickMs(new Date('2026-10-08T11:00:00Z'))).toBe(15_000); // Thu 07:00 ET
    expect(streamTickMs(new Date('2026-10-08T06:00:00Z'))).toBe(60_000); // Thu 02:00 ET
    expect(streamTickMs(new Date('2026-10-10T15:00:00Z'))).toBe(300_000); // Saturday
  });
});

// keep cacheStats referenced (exported for ops/debug)
void cacheStats;
