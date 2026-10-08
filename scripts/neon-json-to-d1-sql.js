#!/usr/bin/env node
/**
 * Convert Neon Postgres JSON exports to D1-compatible SQL INSERT statements
 * 
 * Usage: node scripts/neon-json-to-d1-sql.js <input-dir> [output-file]
 * 
 * Reads: <input-dir>/*.json (per-table arrays of row objects from Neon export)
 * Outputs: <output-file> (default: migration/import.sql) - batched multi-row INSERTs
 * 
 * D1 constraints:
 * - Max 100 bound params per statement
 * - Skip retired tables: news_recommendations, news_refresh_lock
 * - Convert JSONB columns to TEXT (JSON.stringify)
 * - Convert TIMESTAMPTZ to ISO 8601 TEXT strings
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const RETIRED_TABLES = ['news_recommendations', 'news_refresh_lock'];

// Table order respecting dependencies
const TABLE_ORDER = [
  'settings',
  'marks',
  'trades',
  'journal',
  'pair_cache',
  'research_universe',
  'research_etf_map',
  'research_universe_excluded',
  'watchlist',
  'watchlist_quotes',
  'paper_state',
  'paper_positions',
  'paper_orders',
  'paper_journal',
  'crypto_paper_state',
  'crypto_paper_positions',
  'crypto_paper_orders',
  'crypto_paper_journal',
  'paper_flex_state',
  'paper_flex_positions',
  'paper_flex_orders',
  'paper_flex_journal',
  'price_alerts',
];

// Known JSONB columns that need stringify
const JSONB_COLUMNS = {
  settings: ['data'],
};

function sqlEscape(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  // Escape single quotes and wrap in quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}

function convertRow(table, row) {
  const converted = {};
  const jsonbCols = JSONB_COLUMNS[table] || [];

  for (const [key, value] of Object.entries(row)) {
    // Convert JSONB columns to JSON strings
    if (jsonbCols.includes(key)) {
      if (typeof value === 'object' && value !== null) {
        converted[key] = JSON.stringify(value);
      } else if (typeof value === 'string') {
        // Already a string, keep as-is
        converted[key] = value;
      } else {
        converted[key] = value;
      }
    }
    // Convert Date objects to ISO strings
    else if (value instanceof Date) {
      converted[key] = value.toISOString();
    }
    // Convert timestamps (strings that look like ISO dates)
    else if (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
    ) {
      converted[key] = value;
    } else {
      converted[key] = value;
    }
  }

  return converted;
}

function generateBatchedInserts(table, rows) {
  if (!rows || rows.length === 0) {
    return `-- No data for ${table}\n\n`;
  }

  const keys = Object.keys(rows[0]);
  const columns = keys.join(', ');
  const paramsPerRow = keys.length;

  // D1 allows max 100 params per statement
  const maxRowsPerInsert = Math.floor(100 / paramsPerRow);

  let sql = `-- Insert ${rows.length} rows into ${table}\n`;
  sql += `-- (${maxRowsPerInsert} rows per INSERT, ${paramsPerRow} params per row)\n`;

  for (let i = 0; i < rows.length; i += maxRowsPerInsert) {
    const batch = rows.slice(i, i + maxRowsPerInsert);
    const valueClauses = batch
      .map((row) => {
        const values = keys.map((key) => sqlEscape(row[key])).join(', ');
        return `(${values})`;
      })
      .join(',\n  ');

    sql += `INSERT OR IGNORE INTO ${table} (${columns})\nVALUES\n  ${valueClauses};\n\n`;
  }

  return sql;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: node scripts/neon-json-to-d1-sql.js <input-dir> [output-file]

Arguments:
  <input-dir>    Directory containing per-table JSON files (e.g., trades.json, marks.json)
  [output-file]  Output SQL file (default: migration/import.sql)

Example:
  node scripts/neon-json-to-d1-sql.js ./neon-export ./migration/import.sql
`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const inputDir = args[0];
  const outputFile = args[1] || join(process.cwd(), 'migration', 'import.sql');

  if (!existsSync(inputDir)) {
    console.error(`ERROR: Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  const outputDir = join(outputFile, '..');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Reading JSON files from: ${inputDir}`);
  console.log(`Output SQL file: ${outputFile}`);
  console.log('');

  const files = readdirSync(inputDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => basename(f, '.json'));

  if (files.length === 0) {
    console.error(`ERROR: No JSON files found in ${inputDir}`);
    process.exit(1);
  }

  let fullSql = `-- D1 Import Script
-- Generated: ${new Date().toISOString()}
-- Source: Neon Postgres JSON export
-- Converter: neon-json-to-d1-sql.js

`;

  const summary = {};
  let totalRows = 0;

  for (const table of TABLE_ORDER) {
    if (RETIRED_TABLES.includes(table)) {
      console.log(`⊘ Skipping retired table: ${table}`);
      continue;
    }

    const jsonFile = join(inputDir, `${table}.json`);

    if (!existsSync(jsonFile)) {
      console.log(`⚠ Skipping ${table} (no JSON file found)`);
      continue;
    }

    try {
      const rawData = JSON.parse(readFileSync(jsonFile, 'utf8'));

      if (!Array.isArray(rawData)) {
        console.warn(`⚠ Skipping ${table} (not an array)`);
        continue;
      }

      if (rawData.length === 0) {
        console.log(`○ ${table}: 0 rows (empty)`);
        summary[table] = 0;
        fullSql += `-- ${table}: no rows\n\n`;
        continue;
      }

      // Convert rows (handle JSONB and timestamps)
      const convertedRows = rawData.map((row) => convertRow(table, row));

      fullSql += generateBatchedInserts(table, convertedRows);
      summary[table] = convertedRows.length;
      totalRows += convertedRows.length;
      console.log(`✓ ${table}: ${convertedRows.length} rows`);
    } catch (err) {
      console.error(`✗ Error processing ${table}:`, err.message);
      summary[table] = 'ERROR';
    }
  }

  // Handle any extra tables not in TABLE_ORDER
  for (const file of files) {
    if (RETIRED_TABLES.includes(file) || TABLE_ORDER.includes(file)) {
      continue;
    }

    const jsonFile = join(inputDir, `${file}.json`);
    console.log(`⚠ Unknown table: ${file} (appending to end)`);

    try {
      const rawData = JSON.parse(readFileSync(jsonFile, 'utf8'));

      if (!Array.isArray(rawData) || rawData.length === 0) {
        continue;
      }

      const convertedRows = rawData.map((row) => convertRow(file, row));
      fullSql += generateBatchedInserts(file, convertedRows);
      summary[file] = convertedRows.length;
      totalRows += convertedRows.length;
      console.log(`✓ ${file}: ${convertedRows.length} rows`);
    } catch (err) {
      console.error(`✗ Error processing ${file}:`, err.message);
    }
  }

  writeFileSync(outputFile, fullSql);

  console.log('\n' + '='.repeat(60));
  console.log('Conversion Summary:');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Total rows: ${totalRows}`);
  console.log('='.repeat(60));
  console.log(`\nSQL import file generated: ${outputFile}`);
  console.log('\nNext steps:');
  console.log('1. Review the SQL file');
  console.log('2. Create D1 database:');
  console.log('   wrangler d1 create seek-track-db');
  console.log('3. Apply schema:');
  console.log('   wrangler d1 execute seek-track-db --file=server/schema-d1.sql --remote');
  console.log('4. Import data:');
  console.log(`   wrangler d1 execute seek-track-db --file=${outputFile} --remote`);
}

main();
