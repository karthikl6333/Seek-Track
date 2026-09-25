/**
 * Server-Sent Events (SSE) live quote streaming - Cloudflare Workers compatible
 * 
 * Design (CF-safe + subrequest-limited):
 * - Per-connection async loop INSIDE the ReadableStream
 * - Each connection continuously writes response bytes (avoids CF hang detector)
 * - LIMITED universe: only holdings + watchlist (not full research universe)
 * - ALWAYS emit marks from DB (even if refresh skipped due to limits)
 * - Async sleep using setTimeout + Promise (CF Workers compatible)
 * - No shared setInterval (incompatible with CF isolate model)
 * - Auto teardown: loop stops when connection closes
 * 
 * CF Workers subrequest budget per tick:
 * - Typical: 10-20 holdings + 10-20 watchlist = 20-40 symbols
 * - 40 symbols ÷ 10 per chunk = 4 refresh calls
 * - Each refresh: 10 Yahoo + 2 Neon = 12 subrequests
 * - Total: ~50 subrequests (at CF limit, but safe for typical usage)
 * - Fallback: Read-only marks emission if refresh fails (minimal subrequests)
 */

import type { Context } from 'hono';
import { forceRefresh, markActivity } from './quote-service.js';
import { listMarksDetailed } from './quotes.js';
import { query } from './db.js';

// SSE refresh cadence: faster than 30s polling, but not excessive for Yahoo quota
const STREAM_REFRESH_INTERVAL_MS = 3_000; // 3 seconds
const MAX_SYMBOLS_PER_TICK = 40; // CF subrequest limit safety

/**
 * Generate SSE message format
 */
function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * CF Workers-compatible sleep using setTimeout + Promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build LIMITED symbol universe for SSE streaming
 * Only includes: open holdings + watchlist symbols
 * Excludes: full research universe (too many symbols, hits CF subrequest limits)
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

    // Note: Research universe NOT included (can be 50+ symbols, causes subrequest limit)
    // Users see live updates for holdings + watchlist, research updates on manual refresh

  } catch (err) {
    console.error('[QuoteStream] Failed to get live universe:', err);
  }

  return Array.from(symbols).filter(s => s.length > 0).sort();
}

/**
 * Refresh quotes for limited symbol set (CF subrequest aware)
 * Returns true if refresh succeeded, false if skipped/failed
 */
async function refreshLiveQuotes(universe: string[]): Promise<boolean> {
  if (universe.length === 0) {
    return false;
  }

  // Safety: Cap at MAX_SYMBOLS_PER_TICK to stay under CF limits
  const symbols = universe.slice(0, MAX_SYMBOLS_PER_TICK);
  
  if (symbols.length < universe.length) {
    console.log(
      `[QuoteStream] Capping refresh: ${symbols.length}/${universe.length} symbols ` +
      `(CF subrequest limit safety)`
    );
  }

  try {
    // Chunk refresh to stay under CF Workers limits (10 symbols per call)
    const CHUNK_SIZE = 10;
    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
      const chunk = symbols.slice(i, i + CHUNK_SIZE);
      await forceRefresh(chunk);
    }
    return true;
  } catch (err) {
    console.error('[QuoteStream] Refresh failed:', err);
    return false;
  }
}

/**
 * SSE endpoint handler: GET /api/quotes/stream
 * 
 * CF Workers compatible:
 * - Per-connection async loop inside ReadableStream (avoids hang detector)
 * - Limited universe (holdings + watchlist only, not research)
 * - Always emits marks from DB (even if refresh skipped)
 * - Stays under CF subrequest limits
 */
export async function handleQuoteStream(c: Context) {
  markActivity();

  const connectionId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  console.log(`[QuoteStream] New connection: ${connectionId}`);

  // Track connection state
  let closed = false;

  // Create SSE stream with per-connection refresh loop
  const stream = new ReadableStream({
    async start(controller) {
      console.log(`[QuoteStream] Starting stream loop for ${connectionId}`);

      try {
        // Send initial connected event
        controller.enqueue(
          new TextEncoder().encode(
            sseMessage('connected', {
              id: connectionId,
              timestamp: new Date().toISOString(),
              refreshInterval: STREAM_REFRESH_INTERVAL_MS,
            })
          )
        );

        // Per-connection loop: continuously fetch and broadcast
        // This keeps the response active and avoids CF hang detector
        while (!closed) {
          // Wait before next refresh
          await sleep(STREAM_REFRESH_INTERVAL_MS);

          if (closed) break;

          // Get limited universe (holdings + watchlist only)
          const universe = await getLiveStreamUniverse();
          
          if (closed) break;

          // Attempt to refresh (may skip if too many symbols or fails)
          const refreshed = await refreshLiveQuotes(universe);
          
          if (closed) break;

          // ALWAYS emit marks from DB (even if refresh skipped)
          // This ensures client gets updates every tick
          try {
            const data = await listMarksDetailed();
            const message = sseMessage('marks', data);
            controller.enqueue(new TextEncoder().encode(message));
            console.log(
              `[QuoteStream] Sent marks to ${connectionId} ` +
              `(${universe.length} symbols, ${refreshed ? 'refreshed' : 'read-only'})`
            );
          } catch (err) {
            console.error(`[QuoteStream] Failed to send marks to ${connectionId}:`, err);
            // Don't break - try again next tick
          }

          // Send periodic heartbeat comment (keeps connection alive)
          try {
            controller.enqueue(
              new TextEncoder().encode(`: heartbeat ${new Date().toISOString()}\n\n`)
            );
          } catch (err) {
            console.error(`[QuoteStream] Failed to send heartbeat to ${connectionId}:`, err);
            break;
          }
        }
      } catch (err) {
        console.error(`[QuoteStream] Stream error for ${connectionId}:`, err);
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
        console.log(`[QuoteStream] Stream ended for ${connectionId}`);
      }
    },
    cancel() {
      // Connection closed by client
      closed = true;
      console.log(`[QuoteStream] Connection cancelled: ${connectionId}`);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
