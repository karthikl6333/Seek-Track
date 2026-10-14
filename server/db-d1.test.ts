import { describe, expect, it } from 'vitest';
import { convertQueryForD1, ensureSchema, setD1Database, __resetSchemaStateForTests, SCHEMA_VERSION } from './db-d1.js';
import { cursorWithLookback, INCREMENTAL_LOOKBACK_MS } from './quotes.js';

describe('convertQueryForD1', () => {
  it('binds ANY($N) arrays as one JSON param without renumbering later params', () => {
    const r = convertQueryForD1('SELECT * FROM marks WHERE symbol = ANY($1::text[]) AND source = $2', [
      ['A', 'B', 'C'],
      'yahoo',
    ]);
    expect(r.sql).toBe('SELECT * FROM marks WHERE symbol IN (SELECT value FROM json_each(?1)) AND source = ?2');
    expect(r.params).toEqual(['["A","B","C"]', 'yahoo']);
  });

  it('keeps arrays >100 items as a single bound param', () => {
    const big = Array.from({ length: 500 }, (_, i) => `h${i}`);
    const r = convertQueryForD1('SELECT row_hash FROM trades WHERE row_hash = ANY($1)', [big]);
    expect(r.params).toHaveLength(1);
  });

  it('rewrites NOW() and strips casts', () => {
    const r = convertQueryForD1(
      "INSERT INTO settings (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, x = NOW(), n = COUNT(*)::int",
      [{ a: 1 }],
    );
    expect(r.sql).not.toMatch(/NOW\(\)|::/);
    expect(r.sql).toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    expect(r.params).toEqual(['{"a":1}']);
  });

  it('normalizes Date/undefined/boolean params', () => {
    const d = new Date('2026-10-08T00:00:00.000Z');
    const r = convertQueryForD1('SELECT $1, $2, $3', [d, undefined, true]);
    expect(r.params).toEqual(['2026-10-08T00:00:00.000Z', null, 1]);
  });

  it('leaves json path literals like $.key alone', () => {
    const r = convertQueryForD1("UPDATE settings SET data = json_set(data, '$.watchlistSeeded', json('true'))", []);
    expect(r.sql).toContain("'$.watchlistSeeded'");
  });

  it('converts the schema_meta upsert used by ensureSchema', () => {
    const r = convertQueryForD1(
      'INSERT INTO schema_meta (id, version) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version',
      [1, 1],
    );
    expect(r.sql).toContain('?1');
    expect(r.params).toEqual([1, 1]);
  });
});

describe('SSE cursor lookback', () => {
  it('rewinds the cursor by INCREMENTAL_LOOKBACK_MS so concurrent writes are not skipped', () => {
    const cursor = '2026-10-08T12:00:00.000Z';
    const back = cursorWithLookback(cursor);
    expect(Date.parse(cursor) - Date.parse(back)).toBe(INCREMENTAL_LOOKBACK_MS);
  });

  it('passes through unparseable cursors unchanged', () => {
    expect(cursorWithLookback('not-a-date')).toBe('not-a-date');
  });
});

describe('Schema version upgrade from v2 to v3', () => {
  it('creates plan_rules tables when upgrading from v2', async () => {
    // This test verifies the fix for the production hotfix issue:
    // Production was at v2, but PR #87 added plan_rules tables without bumping version
    
    // Use sql.js like read-budget.test.ts does
    const initSqlJs = (await import('sql.js')).default;
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    
    const here = dirname(fileURLToPath(import.meta.url));
    const SQL = await initSqlJs();
    
    // Create in-memory database
    const testDb = new SQL.Database();
    
    // Load and execute v2 schema (without plan_rules tables)
    const schemaPath = join(here, 'schema-d1.sql');
    let schema = readFileSync(schemaPath, 'utf8');
    
    // Remove v3 additions (plan_rules tables) to simulate v2 state
    const v3StartComment = '-- v3: Plan rules for Plan vs Price card';
    const v3Start = schema.indexOf(v3StartComment);
    if (v3Start > -1) {
      schema = schema.substring(0, v3Start);
    }
    
    // Execute v2 schema
    const statements = schema
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const stmt of statements) {
      testDb.run(stmt);
    }
    
    // Set schema version to 2
    testDb.run('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)');
    testDb.run('INSERT OR REPLACE INTO schema_meta (id, version) VALUES (1, 2)');
    
    // Verify starting state: v2, no plan_rules table
    const versionBefore = testDb.exec('SELECT version FROM schema_meta WHERE id = 1')[0].values[0][0];
    expect(versionBefore).toBe(2);
    
    // Check that plan_rules table doesn't exist
    const tablesBefore = testDb.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'plan_rule%'");
    expect(tablesBefore.length).toBe(0);
    
    // Now create a mock D1 database that wraps our sql.js instance
    const mockDB = {
      prepare: (sql: string) => {
        return {
          bind: (...params: any[]) => ({
            all: async () => {
              try {
                const result = testDb.exec(sql, params);
                const results = result.length > 0
                  ? result[0].values.map(row => {
                      const obj: any = {};
                      result[0].columns.forEach((col, i) => {
                        obj[col] = row[i];
                      });
                      return obj;
                    })
                  : [];
                return { results, meta: { rows_read: results.length } };
              } catch (err: any) {
                throw new Error(`D1_ERROR: ${err.message}`);
              }
            },
            run: async () => {
              try {
                testDb.run(sql, params);
                return { meta: { changes: testDb.getRowsModified() } };
              } catch (err: any) {
                throw new Error(`D1_ERROR: ${err.message}`);
              }
            },
          }),
          all: async () => {
            try {
              const result = testDb.exec(sql);
              const results = result.length > 0
                ? result[0].values.map(row => {
                    const obj: any = {};
                    result[0].columns.forEach((col, i) => {
                      obj[col] = row[i];
                    });
                    return obj;
                  })
                : [];
              return { results, meta: { rows_read: results.length } };
            } catch (err: any) {
              throw new Error(`D1_ERROR: ${err.message}`);
            }
          },
          run: async () => {
            try {
              testDb.run(sql);
              return { meta: { changes: testDb.getRowsModified() } };
            } catch (err: any) {
              throw new Error(`D1_ERROR: ${err.message}`);
            }
          },
        };
      },
      batch: async (statements: any[]) => {
        const results = [];
        for (const stmt of statements) {
          results.push(await stmt.run());
        }
        return results;
      },
    };

    // Set up the mock DB
    setD1Database(mockDB as any);
    __resetSchemaStateForTests();

    // Run ensureSchema - should detect version mismatch and run migration
    await ensureSchema();

    // Verify upgrade happened
    const versionAfter = testDb.exec('SELECT version FROM schema_meta WHERE id = 1')[0].values[0][0];
    expect(versionAfter).toBe(SCHEMA_VERSION); // Should be 3 now
    
    const tablesAfter = testDb.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'plan_rule%' ORDER BY name");
    const tableNames = tablesAfter.length > 0 ? tablesAfter[0].values.flat() : [];
    expect(tableNames).toEqual(['plan_rule_notifications', 'plan_rules']);
    
    // Verify we can query the new tables
    const rulesResult = testDb.exec('SELECT COUNT(*) as count FROM plan_rules');
    expect(rulesResult.length).toBeGreaterThan(0); // Should work without error
    
    testDb.close();
  });
});
