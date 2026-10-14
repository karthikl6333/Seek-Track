/**
 * Cloudflare Pages Scheduled Function
 * 
 * This runs on a cron schedule defined in wrangler.toml
 * 
 * To enable:
 * 1. Add to wrangler.toml:
 *    [triggers]
 *    crons = ["0 0 * * *"]  # Daily at midnight UTC
 * 
 * 2. Deploy: wrangler pages deploy dist-cf --project-name=seek-track
 */

import type { ScheduledEvent } from '@cloudflare/workers-types';

export async function onSchedule(event: ScheduledEvent) {
  console.log('[Scheduled] Running daily plan rule notifications check');
  
  try {
    // Import and run the notification evaluation
    const { evaluatePlanRuleNotifications } = await import('../server/plan-rule-notifications');
    const result = await evaluatePlanRuleNotifications();
    
    console.log(`[Scheduled] Evaluated ${result.evaluated} rules, sent ${result.notified} notifications`);
  } catch (err) {
    console.error('[Scheduled] Failed to evaluate plan rule notifications:', err);
    throw err;
  }
}
