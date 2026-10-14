/**
 * Seed initial plan rules for the user
 * Idempotent: only adds rules that don't exist (by symbol + rule_type + level/date)
 * Safe to call multiple times - won't duplicate or re-add deleted rules
 */

import { query } from './db.js';

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

/** Deterministic primary key for a seed rule, so concurrent/re-run seeds can't duplicate it. */
export function seedRuleId(seed: SeedRule): string {
  const key = seed.priceLevel !== undefined ? String(seed.priceLevel) : seed.deadlineDate ?? '';
  return `seed-${seed.symbol}-${seed.ruleType}-${key}`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
}

export { SEED_RULES };

/**
 * Idempotent seed. Each rule is ONE atomic statement:
 *  - deterministic id + ON CONFLICT (id) DO NOTHING: re-runs and racing isolates never duplicate;
 *  - WHERE NOT EXISTS (same symbol + type + level/date): a matching rule created earlier (e.g. with
 *    a random id, or already edited by the user) is never duplicated or overwritten.
 * Existing rows are never UPDATEd.
 */
export async function seedPlanRules(): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  for (const seed of SEED_RULES) {
    const match =
      seed.priceLevel !== undefined
        ? 'p.price_level IS NOT NULL AND ABS(p.price_level - $4) < 0.01'
        : 'p.deadline_date = $5';
    const now = new Date().toISOString();
    const res = await query(
      `INSERT INTO plan_rules (id, symbol, account, rule_type, price_level, deadline_date, note, active, created_at, updated_at)
       SELECT $1, $2, 'real', $3, $4, $5, $6, 1, $7, $7
       WHERE NOT EXISTS (
         SELECT 1 FROM plan_rules p WHERE p.symbol = $2 AND p.rule_type = $3 AND ${match}
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        seedRuleId(seed),
        seed.symbol,
        seed.ruleType,
        seed.priceLevel ?? null,
        seed.deadlineDate ?? null,
        seed.note ?? null,
        now,
      ],
    );
    if ((res.rowCount ?? 0) > 0) added++;
    else skipped++;
  }

  console.log(`[SeedPlanRules] Complete: added ${added}, skipped ${skipped}`);
  return { added, skipped };
}
