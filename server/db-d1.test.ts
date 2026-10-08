import { describe, expect, it } from 'vitest';
import { convertQueryForD1 } from './db-d1.js';
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
