/**
 * Live refresh endpoint for SSE streaming
 * 
 * Design: Separate short-lived Worker invocation for Yahoo refresh
 * - Each POST gets fresh 50 subrequest budget
 * - Stampede guard: only refresh if last update > 3s ago
 * - Limited universe: holdings + watchlist only (~20-40 symbols)
 * - Writes to marks table for SSE to read
 */

import type { Context } from 'hono';
import { forceRefresh, markActivity } from './quote-service.js';
import { query } from './db.js';

const LIVE_REFRESH_INTERVAL_MS = 3_000; // 3 seconds
const MAX_SYMBOLS_PER_REFRESH = 40; // CF subrequest limit safety

/**
 * Get limited universe for live streaming (holdings + watchlist only)
 */
async function getLiveStreamUniverse(): Promise<string[]> {
  const symbols = new Set<string>();

  try {
    // Holdings: compute net positions (only open positions)
    const holdingsRes = await query<{ symbol: string }>(
      `SELECT symbol
       FROM trades
       GROUP BY symbol
       HAVING SUM(
         CASE 
           WHEN LOWER(action) LIKE '%short%' THEN -ABS(quantity)
           WHEN LOWER(action) LIKE '%cover%' THEN ABS(quantity)
           WHEN LOWER(action) LIKE '%buy%' OR LOWER(action) LIKE 'bought%' THEN ABS(quantity)
           WHEN LOWER(action) LIKE '%sell%' OR LOWER(action) LIKE 'sold%' THEN -ABS(quantity)
           ELSE 0
         END
       ) <> 0`
    );
    for (const r of holdingsRes.rows) {
      symbols.add(r.symbol.toUpperCase().trim());
    }

    // Watchlist
    const watchlistRes = await query<{ symbol: string }>(`SELECT symbol FROM watchlist`);
    for (const r of watchlistRes.rows) {
      symbols.add(r.symbol.toUpperCase().trim());
    }

  } catch (err) {
    console.error('[LiveRefresh] Failed to get universe:', err);
  }

  return Array.from(symbols).filter(s => s.length > 0).sort();
}

/**
 * Get last live refresh timestamp from marks table
 */
async function getLastLiveRefreshAt(): Promise<Date | null> {
  try {
    const res = await query<{ updated_at: Date }>(
      `SELECT MAX(updated_at) as updated_at FROM marks`
    );
    return res.rows[0]?.updated_at || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/quotes/live-refresh
 * 
 * Short-lived endpoint for SSE background refresh
 * - Fresh 50 subrequest budget per invocation
 * - Stampede guard: skip if refreshed within last 3s
 * - Limited universe: holdings + watchlist only
 */
export async function handleLiveRefresh(c: Context) {
  markActivity();

  try {
    // Stampede guard: check last refresh time
    const lastRefresh = await getLastLiveRefreshAt();
    const now = new Date();
    
    if (lastRefresh) {
      const msSinceRefresh = now.getTime() - lastRefresh.getTime();
      if (msSinceRefresh < LIVE_REFRESH_INTERVAL_MS) {
        console.log(
          `[LiveRefresh] Skipped (last refresh ${msSinceRefresh}ms ago, threshold ${LIVE_REFRESH_INTERVAL_MS}ms)`
        );
        return c.json({
          ok: true,
          skipped: true,
          reason: 'Recent refresh',
          msSinceRefresh,
          threshold: LIVE_REFRESH_INTERVAL_MS,
        });
      }
    }

    // Get limited universe
    const universe = await getLiveStreamUniverse();
    const symbols = universe.slice(0, MAX_SYMBOLS_PER_REFRESH);

    if (symbols.length === 0) {
      console.log('[LiveRefresh] No symbols to refresh');
      return c.json({
        ok: true,
        updated: [],
        total: 0,
      });
    }

    console.log(`[LiveRefresh] Refreshing ${symbols.length} symbols`);

    // Chunk refresh to stay under CF limits (10 symbols per call)
    const CHUNK_SIZE = 10;
    const allUpdated: string[] = [];
    const allFailed: string[] = [];

    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);
      const result = await forceRefresh(chunk);
      allUpdated.push(...result.updated);
      allFailed.push(...result.failed);
    }

    console.log(
      `[LiveRefresh] Completed: ${allUpdated.length} updated, ${allFailed.length} failed`
    );

    return c.json({
      ok: true,
      updated: allUpdated,
      failed: allFailed,
      total: symbols.length,
      refreshedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[LiveRefresh] Error:', err);
    return c.json(
      {
        ok: false,
        error: String(err),
      },
      500
    );
  }
}
