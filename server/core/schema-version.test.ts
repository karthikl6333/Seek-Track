/**
 * Schema version guard + v2 → v3 migration on a real SQLite DB (sql.js behind a D1-shaped binding).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setD1Database } from '../db.js';
import { __resetSchemaStateForTests, ensureSchema } from '../db-d1.js';
import { __resetIsolateCacheForTests } from './isolate-cache.js';
import { SCHEMA_SHA256, SCHEMA_VERSION } from './schema-version.js';
import { SEED_RULES, seedPlanRules, seedRuleId } from '../plan/seed-plan-rules.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaText = readFileSync(join(here, '..', 'schema-d1.sql'), 'utf8');
/** Exact schema shipped in #86 (prod is at v2 with this). */
const schemaV2 = readFileSync(join(here, 'fixtures', 'schema-d1.v2.sql'), 'utf8');
/** Exact schema shipped in v3 (prod is at v3 with this; watchlist_quotes has no short_name). */
const schemaV3 = readFileSync(join(here, 'fixtures', 'schema-d1.v3.sql'), 'utf8');

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let sqlite: Database;
/** Every statement the app sent to "D1", in order. */
const executed: string[] = [];

function runOne(sql: string, params: unknown[]) {
  executed.push(sql);
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

const tables = () =>
  (sqlite.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).flat().map(String);
const version = () => sqlite.exec('SELECT version FROM schema_meta WHERE id = 1')[0].values[0][0];
const rules = () =>
  (sqlite.exec('SELECT id, symbol, rule_type, price_level, deadline_date, note FROM plan_rules ORDER BY id')[0]
    ?.values ?? []) as unknown[][];

/** A DB exactly like prod before this fix: #86 schema, schema_meta = 2, no plan tables. */
function makeProdV2Db() {
  sqlite.exec(schemaV2);
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);' +
      'INSERT OR REPLACE INTO schema_meta (id, version) VALUES (1, 2);',
  );
}

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  sqlite = new SQL.Database();
  executed.length = 0;
  __resetIsolateCacheForTests();
  __resetSchemaStateForTests();
  setD1Database(makeFakeD1() as never);
});

afterEach(() => sqlite.close());

describe('schema version guard', () => {
  it('schema-d1.sql matches the hash recorded for SCHEMA_VERSION (bump the version when it changes)', () => {
    const sha = createHash('sha256').update(schemaText.replace(/\r\n/g, '\n')).digest('hex');
    expect(
      sha,
      `server/schema-d1.sql changed without a schema version bump.\n` +
        `Bump SCHEMA_VERSION in server/schema-version.ts (existing DBs only re-run the schema on a ` +
        `version change) and set SCHEMA_SHA256 = '${sha}'.`,
    ).toBe(SCHEMA_SHA256);
  });

  it('v2 fixture really is the pre-plan schema', () => {
    expect(schemaV2).not.toMatch(/plan_rules/);
    expect(SCHEMA_VERSION).toBe(4);
  });
});

describe('prod v2 → current migration', () => {
  it('creates the plan tables, seeds the rules, records the current version; then no extra reads/writes', async () => {
    makeProdV2Db();
    expect(tables()).not.toContain('plan_rules');

    await ensureSchema();

    expect(tables()).toEqual(expect.arrayContaining(['plan_rules', 'plan_rule_notifications']));
    expect(version()).toBe(4);
    const seeded = rules();
    expect(seeded).toHaveLength(SEED_RULES.length);
    expect(seeded.map((r) => r[0])).toEqual(SEED_RULES.map(seedRuleId).sort());
    expect(seeded.find((r) => r[1] === 'SOXL')).toEqual([
      'seed-soxl-target-150', 'SOXL', 'target', 150, null, "don't rebuy before Nov 4",
    ]);

    // Same isolate: nothing at all.
    executed.length = 0;
    await ensureSchema();
    expect(executed).toEqual([]);

    // New isolate on the migrated DB: exactly one version read, no DDL / seed.
    __resetSchemaStateForTests();
    await ensureSchema();
    expect(executed).toEqual(['SELECT version FROM schema_meta WHERE id = 1']);
    expect(rules()).toHaveLength(SEED_RULES.length);
  });

  it('a fresh (empty) DB also ends at the current version with the rules seeded once', async () => {
    await ensureSchema();
    expect(version()).toBe(4);
    expect(rules()).toHaveLength(SEED_RULES.length);
  });

  it('if seeding fails the version is NOT recorded, so the next isolate retries', async () => {
    makeProdV2Db();
    // Break the seed: plan_rules exists with an incompatible shape (no rule_type column).
    sqlite.exec('CREATE TABLE plan_rules (id TEXT PRIMARY KEY, symbol TEXT)');
    await expect(ensureSchema()).rejects.toThrow();
    expect(version()).toBe(2);
  });
});

describe('seedPlanRules idempotency', () => {
  beforeEach(async () => {
    makeProdV2Db();
    await ensureSchema();
  });

  it('re-running adds nothing and duplicates nothing', async () => {
    const before = rules();
    expect(await seedPlanRules()).toEqual({ added: 0, skipped: SEED_RULES.length });
    expect(await seedPlanRules()).toEqual({ added: 0, skipped: SEED_RULES.length });
    expect(rules()).toEqual(before);
  });

  it('never overwrites a user-edited seeded rule', async () => {
    sqlite.run("UPDATE plan_rules SET note = 'my note', active = 0 WHERE id = 'seed-smh-stop-561.92'");
    await seedPlanRules();
    const r = sqlite.exec("SELECT note, active FROM plan_rules WHERE id = 'seed-smh-stop-561.92'")[0].values[0];
    expect(r).toEqual(['my note', 0]);
  });

  it('does not duplicate a matching rule created earlier with a random id', async () => {
    sqlite.run('DELETE FROM plan_rules');
    sqlite.run(
      "INSERT INTO plan_rules (id, symbol, account, rule_type, price_level) VALUES ('abc123', 'SOXL', 'real', 'target', 150.004)",
    );
    const res = await seedPlanRules();
    expect(res.added).toBe(SEED_RULES.length - 1);
    expect(sqlite.exec("SELECT COUNT(*) FROM plan_rules WHERE symbol = 'SOXL'")[0].values[0][0]).toBe(1);
  });

  it('concurrent seeds (two isolates) still produce one row per rule', async () => {
    sqlite.run('DELETE FROM plan_rules');
    await Promise.all([seedPlanRules(), seedPlanRules()]);
    expect(rules()).toHaveLength(SEED_RULES.length);
  });
});

const wqColumns = () =>
  (sqlite.exec('PRAGMA table_info(watchlist_quotes)')[0]?.values ?? []).map((r) => String(r[1]));

const V4_COLUMNS = ['short_name', 'shares_outstanding', 'cap_price', 'fundamentals_updated_at'];

describe('prod v3 → v4 migration (watchlist_quotes.short_name + fundamentals columns)', () => {
  function makeProdV3Db() {
    sqlite.exec(schemaV3);
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);' +
        'INSERT OR REPLACE INTO schema_meta (id, version) VALUES (1, 3);' +
        "INSERT INTO watchlist_quotes (symbol, last, pct_change, market_cap, week52_high, week52_low) VALUES ('AVGO', 327.13, -5.18, 1.5e12, 495, 289.96);",
    );
  }

  it('v3 fixture has none of the v4 columns; the current schema has them all', () => {
    sqlite.exec(schemaV3);
    for (const c of V4_COLUMNS) {
      expect(wqColumns()).not.toContain(c);
      expect(schemaText).toContain(`${c} `);
    }
  });

  it('adds the column to the existing table, keeps rows, records v4', async () => {
    makeProdV3Db();
    for (const c of V4_COLUMNS) expect(wqColumns()).not.toContain(c);

    await ensureSchema();

    for (const c of V4_COLUMNS) expect(wqColumns()).toContain(c);
    expect(version()).toBe(4);
    const row = sqlite.exec("SELECT last, market_cap, week52_high, short_name, shares_outstanding, cap_price, fundamentals_updated_at FROM watchlist_quotes WHERE symbol = 'AVGO'")[0]
      .values[0];
    expect(row).toEqual([327.13, 1.5e12, 495, null, null, null, null]);
    // The new columns are writable.
    sqlite.run("UPDATE watchlist_quotes SET short_name = 'Broadcom Inc.', shares_outstanding = 4.77e9, cap_price = 326, fundamentals_updated_at = '2026-10-31T00:00:00Z' WHERE symbol = 'AVGO'");
    expect(sqlite.exec("SELECT short_name, shares_outstanding, cap_price, fundamentals_updated_at FROM watchlist_quotes")[0].values[0]).toEqual(['Broadcom Inc.', 4.77e9, 326, '2026-10-31T00:00:00Z']);
  });

  it('is idempotent: re-running on a migrated DB does not fail or duplicate the column', async () => {
    makeProdV3Db();
    await ensureSchema();
    sqlite.run('UPDATE schema_meta SET version = 3 WHERE id = 1'); // force the migration to run again
    __resetSchemaStateForTests();
    await ensureSchema();
    for (const c of V4_COLUMNS) expect(wqColumns().filter((x) => x === c)).toHaveLength(1);
    expect(version()).toBe(4);
  });

  it('a DB already on the earlier v4 (short_name only) picks up the remaining columns', async () => {
    makeProdV3Db();
    sqlite.run('ALTER TABLE watchlist_quotes ADD COLUMN short_name TEXT');
    await ensureSchema();
    for (const c of V4_COLUMNS) expect(wqColumns().filter((x) => x === c)).toHaveLength(1);
  });

  it('a fresh DB gets the columns from CREATE TABLE and ensureColumn adds nothing', async () => {
    await ensureSchema();
    for (const c of V4_COLUMNS) expect(wqColumns().filter((x) => x === c)).toHaveLength(1);
    expect(executed.some((q) => /ALTER TABLE watchlist_quotes/i.test(q))).toBe(false);
  });

  it('no extra reads on the steady-state path: new isolate does exactly one version read', async () => {
    makeProdV3Db();
    await ensureSchema();
    executed.length = 0;
    __resetSchemaStateForTests();
    await ensureSchema();
    expect(executed).toEqual(['SELECT version FROM schema_meta WHERE id = 1']);
  });
});
