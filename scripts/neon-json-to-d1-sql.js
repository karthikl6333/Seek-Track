#!/usr/bin/env node
/**
 * Convert Neon Postgres JSON exports (one <table>.json array per table) into a
 * D1-compatible SQL import file.
 *
 * Usage:
 *   node scripts/neon-json-to-d1-sql.js <input-dir> [output-file] [--export-tz=+05:30]
 *
 * Guarantees (fails loudly with a non-zero exit instead of silently dropping data):
 * - Column list comes from server/schema-d1.sql. Backup columns that no longer exist
 *   in the schema are dropped ONLY if every value is NULL (legacy columns); otherwise
 *   the script aborts.
 * - Each table is emptied (DELETE FROM) and then filled with plain INSERTs, so the
 *   schema's seed rows (settings id=1 '{}', *_state id=1 defaults) are replaced by the
 *   backup rows instead of the backup rows being IGNOREd.
 * - Objects/arrays (JSONB) are written as JSON text; booleans as 1/0.
 * - Postgres DATE columns that were serialized by a JS Date in a non-UTC export
 *   timezone (e.g. "2026-10-04T18:30:00.000Z" for DATE 2026-10-05 exported from IST)
 *   are converted back to YYYY-MM-DD using --export-tz (default +05:30).
 * - No BEGIN/COMMIT (wrangler d1 remote import rejects them); every statement is
 *   kept well under D1's 100KB statement limit.
 * - Retired tables (news_recommendations, news_refresh_lock) are skipped.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RETIRED_TABLES = new Set(['news_recommendations', 'news_refresh_lock']);

// Postgres DATE columns (stored as YYYY-MM-DD TEXT in D1)
const DATE_COLUMNS = {
  paper_state: ['mandate_start', 'mandate_end'],
  crypto_paper_state: ['mandate_start', 'mandate_end'],
  paper_flex_state: ['mandate_start', 'mandate_end'],
};

const MAX_ROWS_PER_INSERT = 50;
const MAX_STATEMENT_BYTES = 50_000; // D1 limit is 100KB per statement

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(here, '..', 'server', 'schema-d1.sql');

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

/** Parse CREATE TABLE blocks from schema-d1.sql -> Map<table, string[] columns> (schema order). */
function loadSchemaColumns(schemaPath) {
  const text = readFileSync(schemaPath, 'utf8');
  const tables = new Map();
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const cols = [];
    for (const rawLine of m[2].split('\n')) {
      const line = rawLine.replace(/--.*$/, '').trim();
      if (!line) continue;
      const first = line.split(/\s+/)[0].replace(/[",]/g, '');
      if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i.test(first)) continue;
      cols.push(first);
    }
    tables.set(m[1], cols);
  }
  if (tables.size === 0) die(`no CREATE TABLE statements parsed from ${schemaPath}`);
  return tables;
}

function parseTzOffsetMinutes(s) {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(s);
  if (!m) die(`invalid --export-tz "${s}" (expected e.g. +05:30)`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function toDateOnly(table, col, value, tzOffsetMin) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') die(`${table}.${col}: unexpected non-string DATE value ${JSON.stringify(value)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = Date.parse(value);
  if (Number.isNaN(t)) die(`${table}.${col}: unparseable DATE value ${JSON.stringify(value)}`);
  const local = new Date(t + tzOffsetMin * 60_000);
  if (local.getUTCHours() !== 0 || local.getUTCMinutes() !== 0 || local.getUTCSeconds() !== 0 || local.getUTCMilliseconds() !== 0) {
    die(
      `${table}.${col}: ${value} is not midnight in export timezone offset ${tzOffsetMin}min; ` +
        `pass the timezone the backup was exported in via --export-tz`,
    );
  }
  return local.toISOString().slice(0, 10);
}

/**
 * SQLite's decimal text->double parser is not always correctly rounded (e.g. sqlite 3.46
 * reads '37.777393' as 37.777393000000004). To keep every REAL bit-identical, non-integer
 * doubles are written as an exact ratio m / 2^k (m < 2^53 integer, power-of-two divisors),
 * which involves only exact integer->double conversions and an exact division.
 */
function exactNumberLiteral(v) {
  if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return String(v);
  let m = v;
  let k = 0;
  while (!Number.isInteger(m) && k < 1074) {
    m *= 2; // exact (power-of-two scaling)
    k += 1;
  }
  if (!Number.isInteger(m) || Math.abs(m) > Number.MAX_SAFE_INTEGER) return v.toPrecision(17);
  let expr = `CAST(${m} AS REAL)`;
  while (k > 0) {
    const step = Math.min(k, 62);
    expr += ` / ${(2n ** BigInt(step)).toString()}`;
    k -= step;
  }
  return `(${expr})`;
}

function sqlLiteral(table, col, value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) die(`${table}.${col}: non-finite number`);
    return exactNumberLiteral(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object') value = JSON.stringify(value); // JSONB object/array -> JSON text
  const s = String(value);
  if (s.includes('\u0000')) die(`${table}.${col}: string contains NUL byte`);
  return `'${s.replace(/'/g, "''")}'`;
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function buildTableSql(table, rows, schemaCols, tzOffsetMin) {
  // Union of keys across all rows (don't trust rows[0] alone)
  const backupCols = new Set();
  for (const r of rows) for (const k of Object.keys(r)) backupCols.add(k);

  const dropped = [];
  for (const c of backupCols) {
    if (schemaCols.includes(c)) continue;
    const nonNull = rows.filter((r) => r[c] !== null && r[c] !== undefined).length;
    if (nonNull > 0) die(`${table}.${c} is not in schema-d1.sql but has ${nonNull} non-null values; refusing to drop data`);
    dropped.push(c);
  }
  const cols = schemaCols.filter((c) => backupCols.has(c));
  const dateCols = DATE_COLUMNS[table] || [];

  let sql = `-- ${table}: ${rows.length} rows\nDELETE FROM ${quoteIdent(table)};\n`;
  if (rows.length === 0) return { sql: sql + '\n', dropped };

  const head = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES\n`;
  let batch = [];
  let batchBytes = head.length;
  const flush = () => {
    if (batch.length === 0) return;
    sql += head + batch.join(',\n') + ';\n';
    batch = [];
    batchBytes = head.length;
  };
  for (const row of rows) {
    const vals = cols.map((c) => {
      let v = row[c];
      if (dateCols.includes(c)) v = toDateOnly(table, c, v, tzOffsetMin);
      return sqlLiteral(table, c, v);
    });
    const tuple = `(${vals.join(', ')})`;
    if (head.length + tuple.length + 2 > MAX_STATEMENT_BYTES) die(`${table}: single row exceeds ${MAX_STATEMENT_BYTES} bytes`);
    if (batch.length >= MAX_ROWS_PER_INSERT || batchBytes + tuple.length + 2 > MAX_STATEMENT_BYTES) flush();
    batch.push(tuple);
    batchBytes += tuple.length + 2;
  }
  flush();
  return { sql: sql + '\n', dropped };
}

function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const pos = args.filter((a) => !a.startsWith('--'));

  if (pos.length === 0 || flags.includes('--help') || flags.includes('-h')) {
    console.log(`
Usage: node scripts/neon-json-to-d1-sql.js <input-dir> [output-file] [--export-tz=+05:30]

  <input-dir>     Directory with per-table JSON arrays (trades.json, marks.json, ...). Read-only.
  [output-file]   Output SQL file (default: migration/import.sql)
  --export-tz     UTC offset of the machine that produced the JSON export; used to turn
                  JS-serialized Postgres DATE values back into YYYY-MM-DD (default +05:30)
`);
    process.exit(pos.length === 0 ? 1 : 0);
  }

  const tzFlag = flags.find((f) => f.startsWith('--export-tz='));
  const tzOffsetMin = parseTzOffsetMinutes(tzFlag ? tzFlag.split('=')[1] : '+05:30');

  const inputDir = pos[0];
  const outputFile = pos[1] || join(process.cwd(), 'migration', 'import.sql');
  if (!existsSync(inputDir)) die(`input directory not found: ${inputDir}`);
  mkdirSync(dirname(resolve(outputFile)), { recursive: true });

  const schema = loadSchemaColumns(SCHEMA_PATH);
  const files = readdirSync(inputDir).filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json'));
  if (files.length === 0) die(`no JSON files found in ${inputDir}`);

  for (const f of files) {
    if (!RETIRED_TABLES.has(f) && !schema.has(f)) die(`backup file ${f}.json has no matching table in schema-d1.sql`);
  }

  let out = `-- D1 import generated by scripts/neon-json-to-d1-sql.js at ${new Date().toISOString()}\n` +
    `-- Source: ${resolve(inputDir)}\n` +
    `-- Apply AFTER server/schema-d1.sql. Replaces the full contents of every table below.\n` +
    `-- No BEGIN/COMMIT on purpose (wrangler d1 execute --remote rejects them).\n\n`;

  const summary = {};
  let total = 0;
  for (const [table, cols] of schema) {
    const file = join(inputDir, `${table}.json`);
    if (!existsSync(file)) {
      console.warn(`⚠ ${table}: no ${table}.json in backup (table left as created by schema)`);
      summary[table] = 'MISSING';
      continue;
    }
    let rows;
    try {
      rows = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      die(`${table}.json: ${err.message}`);
    }
    if (!Array.isArray(rows)) die(`${table}.json is not a JSON array`);
    const { sql, dropped } = buildTableSql(table, rows, cols, tzOffsetMin);
    if (dropped.length) console.warn(`⚠ ${table}: dropped legacy all-NULL column(s) not in schema: ${dropped.join(', ')}`);
    out += sql;
    summary[table] = rows.length;
    total += rows.length;
    console.log(`✓ ${table}: ${rows.length} rows`);
  }
  for (const f of files) if (RETIRED_TABLES.has(f)) console.log(`⊘ skipped retired table: ${f}`);

  writeFileSync(outputFile, out);
  console.log(`\nTotal rows: ${total}\nWrote ${outputFile}`);
  console.log(JSON.stringify(summary));
}

main();
