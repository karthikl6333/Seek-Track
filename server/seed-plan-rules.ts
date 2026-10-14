/**
 * Seed initial plan rules for the user
 * Run once during initial setup or via manual API call
 */

import { createPlanRule } from './plan-rules.js';

export async function seedPlanRules(): Promise<void> {
  console.log('[Seed] Seeding initial plan rules...');

  const seeds = [
    // SOXL target 150 (sell; note "don't rebuy before Nov 4")
    {
      symbol: 'SOXL',
      ruleType: 'target' as const,
      priceLevel: 150,
      note: "don't rebuy before Nov 4",
    },
    // AVL target 35.44
    {
      symbol: 'AVL',
      ruleType: 'target' as const,
      priceLevel: 35.44,
      note: null,
    },
    // AVL deadline of 2026-10-16 with note "sell at close if still under avg 38.04"
    {
      symbol: 'AVL',
      ruleType: 'deadline' as const,
      deadlineDate: '2026-10-16',
      note: 'sell at close if still under avg 38.04',
    },
    // SMH stop 561.92
    {
      symbol: 'SMH',
      ruleType: 'stop' as const,
      priceLevel: 561.92,
      note: null,
    },
    // SMH no-add-below 585.33 (note "max 20% of equity")
    {
      symbol: 'SMH',
      ruleType: 'no-add-below' as const,
      priceLevel: 585.33,
      note: 'max 20% of equity',
    },
  ];

  let added = 0;
  for (const seed of seeds) {
    try {
      await createPlanRule({
        symbol: seed.symbol,
        account: 'real',
        ruleType: seed.ruleType,
        priceLevel: seed.priceLevel ?? null,
        deadlineDate: seed.deadlineDate ?? null,
        note: seed.note ?? null,
      });
      added++;
      console.log(`[Seed] Added ${seed.ruleType} rule for ${seed.symbol}`);
    } catch (err) {
      // If it fails (e.g., already exists), just log and continue
      console.warn(`[Seed] Skipped ${seed.ruleType} for ${seed.symbol}:`, String(err));
    }
  }

  console.log(`[Seed] Seeding complete. Added ${added}/${seeds.length} rules.`);
}
