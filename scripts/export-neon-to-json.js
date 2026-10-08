#!/usr/bin/env node
/**
 * Export all data from Neon Postgres to JSON files (one per table)
 * Usage: node scripts/export-neon-to-json.js
 * 
 * Requires DATABASE_URL environment variable pointing to Neon Postgres
 * Outputs: ./migration/*.json (one file per table with array of row objects)
 */

import pg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { Pool } = pg;

const TABLES = [
  'trades',
  'marks',
  'journal',
  'settings',
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

async function exportData() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const outputDir = join(process.cwd(), 'migration');
  
  mkdirSync(outputDir, { recursive: true });
  console.log(`Exporting Neon Postgres data to ${outputDir}/`);

  const summary = {};

  for (const table of TABLES) {
    try {
      const result = await pool.query(`SELECT * FROM ${table}`);
      const rows = result.rows;
      
      // Convert Date objects to ISO strings
      const jsonRows = rows.map((row) => {
        const converted = {};
        for (const [key, value] of Object.entries(row)) {
          if (value instanceof Date) {
            converted[key] = value.toISOString();
          } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Handle JSONB columns
            converted[key] = JSON.stringify(value);
          } else {
            converted[key] = value;
          }
        }
        return converted;
      });
      
      const outputPath = join(outputDir, `${table}.json`);
      writeFileSync(outputPath, JSON.stringify(jsonRows, null, 2));
      summary[table] = rows.length;
      console.log(`✓ ${table}: ${rows.length} rows → ${table}.json`);
    } catch (err) {
      console.warn(`⚠ ${table}: table does not exist or error occurred:`, err.message);
      summary[table] = 'ERROR';
    }
  }

  await pool.end();

  console.log('\n' + '='.repeat(60));
  console.log('Export Summary:');
  console.log(JSON.stringify(summary, null, 2));
  console.log('='.repeat(60));
  console.log('\nExport complete! Files saved to ./migration/');
  console.log('\nNext steps:');
  console.log('1. Review the JSON files in ./migration/');
  console.log('2. Run: node scripts/convert-json-to-d1-sql.js');
  console.log('3. Import using: wrangler d1 execute seek-track-db --file=migration/import.sql');
}

exportData().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
