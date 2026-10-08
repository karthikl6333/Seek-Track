#!/usr/bin/env node
/**
 * Convert JSON exports to D1-compatible SQL INSERT statements
 * Usage: node scripts/convert-json-to-d1-sql.js
 * 
 * Reads: ./migration/*.json (output from export-neon-to-json.js)
 * Outputs: ./migration/import.sql (ready for `wrangler d1 execute --file`)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_DIR = join(process.cwd(), 'migration');

function sqlEscape(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  // Escape single quotes and wrap in quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}

function generateInsertStatements(table, rows) {
  if (!rows || rows.length === 0) {
    return `-- No data for ${table}\n`;
  }

  const keys = Object.keys(rows[0]);
  const columns = keys.join(', ');
  let sql = `-- Insert ${rows.length} rows into ${table}\n`;

  for (const row of rows) {
    const values = keys.map((key) => sqlEscape(row[key])).join(', ');
    sql += `INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${values});\n`;
  }

  return sql + '\n';
}

function convertJsonToSql() {
  if (!existsSync(MIGRATION_DIR)) {
    console.error(`ERROR: Migration directory not found: ${MIGRATION_DIR}`);
    console.error('Run: node scripts/export-neon-to-json.js first');
    process.exit(1);
  }

  const files = readdirSync(MIGRATION_DIR).filter((f) => f.endsWith('.json'));
  
  if (files.length === 0) {
    console.error('ERROR: No JSON files found in ./migration/');
    console.error('Run: node scripts/export-neon-to-json.js first');
    process.exit(1);
  }

  let fullSql = `-- D1 Import Script
-- Generated: ${new Date().toISOString()}
-- Source: Neon Postgres export

`;

  const summary = {};

  // Process tables in order to respect dependencies
  const orderedTables = [
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

  for (const table of orderedTables) {
    const jsonFile = join(MIGRATION_DIR, `${table}.json`);
    
    if (!existsSync(jsonFile)) {
      console.warn(`⚠ Skipping ${table} (no JSON file found)`);
      continue;
    }

    try {
      const data = JSON.parse(readFileSync(jsonFile, 'utf8'));
      
      if (!Array.isArray(data)) {
        console.warn(`⚠ Skipping ${table} (not an array)`);
        continue;
      }

      fullSql += generateInsertStatements(table, data);
      summary[table] = data.length;
      console.log(`✓ ${table}: ${data.length} rows converted`);
    } catch (err) {
      console.error(`✗ Error processing ${table}:`, err.message);
      summary[table] = 'ERROR';
    }
  }

  const outputPath = join(MIGRATION_DIR, 'import.sql');
  writeFileSync(outputPath, fullSql);

  console.log('\n' + '='.repeat(60));
  console.log('Conversion Summary:');
  console.log(JSON.stringify(summary, null, 2));
  console.log('='.repeat(60));
  console.log(`\nSQL import file generated: ${outputPath}`);
  console.log('\nNext steps:');
  console.log('1. Review migration/import.sql');
  console.log('2. Import to D1:');
  console.log('   wrangler d1 execute seek-track-db --file=migration/import.sql --remote');
}

convertJsonToSql();
