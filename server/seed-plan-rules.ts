/**
 * Seed initial plan rules for the user
 * Idempotent: only adds rules that don't exist (by symbol + rule_type + level/date)
 * Safe to call multiple times - won't duplicate or re-add deleted rules
 */

import { query } from './db.js';
import { randomUUID } from 'node:crypto';

interface SeedRule {
  symbol: string;
  ruleType: 'target' | 'stop' | 'no-add-below' | 'deadline';
  priceLevel?: number;
  deadlineDate?: string;
  note?: string | null;
}

const SEED_RULES: SeedRule[] = [
  {
    symbol: 'SOXL',
    ruleType: 'target',
    priceLevel: 150,
    note: "don't rebuy before Nov 4",
  },
  {
    symbol: 'AVL',
    ruleType: 'target',
    priceLevel: 35.44,
  },
  {
    symbol: 'AVL',
    ruleType: 'deadline',
    deadlineDate: '2026-10-16',
    note: 'sell at close if still under avg 38.04',
  },
  {
    symbol: 'SMH',
    ruleType: 'stop',
    priceLevel: 561.92,
  },
  {
    symbol: 'SMH',
    ruleType: 'no-add-below',
    priceLevel: 585.33,
    note: 'max 20% of equity',
  },
];

/**
 * Check if a rule matching this spec already exists (active or deleted)
 * Matches on: symbol + rule_type + (price_level OR deadline_date)
 */
async function ruleExists(seed: SeedRule): Promise<boolean> {
  if (seed.priceLevel !== undefined) {
    // Price-based rule: match on symbol, type, and price level (within 0.01)
    const res = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM plan_rules 
       WHERE symbol = $1 AND rule_type = $2 
       AND ABS(price_level - $3) < 0.01`,
      [seed.symbol, seed.ruleType, seed.priceLevel]
    );
    return Number(res.rows[0]?.count ?? 0) > 0;
  } else if (seed.deadlineDate) {
    // Deadline rule: match on symbol, type, and deadline date
    const res = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM plan_rules 
       WHERE symbol = $1 AND rule_type = $2 AND deadline_date = $3`,
      [seed.symbol, seed.ruleType, seed.deadlineDate]
    );
    return Number(res.rows[0]?.count ?? 0) > 0;
  }
  return false;
}

export async function seedPlanRules(): Promise<{ added: number; skipped: number }> {
  console.log('[SeedPlanRules] Starting idempotent seed...');

  let added = 0;
  let skipped = 0;

  for (const seed of SEED_RULES) {
    try {
      // Check if rule already exists
      if (await ruleExists(seed)) {
        console.log(
          `[SeedPlanRules] Skipped ${seed.symbol} ${seed.ruleType} (already exists)`
        );
        skipped++;
        continue;
      }

      // Insert new rule
      const id = randomUUID().replace(/-/g, '');
      const now = new Date().toISOString();

      await query(
        `INSERT INTO plan_rules (id, symbol, account, rule_type, price_level, deadline_date, note, active, created_at, updated_at)
         VALUES ($1, $2, 'real', $3, $4, $5, $6, 1, $7, $8)`,
        [
          id,
          seed.symbol,
          seed.ruleType,
          seed.priceLevel ?? null,
          seed.deadlineDate ?? null,
          seed.note ?? null,
          now,
          now,
        ]
      );

      console.log(`[SeedPlanRules] Added ${seed.symbol} ${seed.ruleType}`);
      added++;
    } catch (err) {
      console.error(
        `[SeedPlanRules] Failed to add ${seed.symbol} ${seed.ruleType}:`,
        String(err)
      );
      skipped++;
    }
  }

  console.log(`[SeedPlanRules] Complete: added ${added}, skipped ${skipped}`);
  return { added, skipped };
}
