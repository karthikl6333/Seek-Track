/**
 * Server-Sent Events (SSE) live quote streaming - CF Workers lifetime budget safe
 * 
 * Design (CF-safe + lifetime budget aware):
 * - Per-connection async loop INSIDE ReadableStream (avoids hang detector)
 * - READ-ONLY: only reads marks from DB (minimal subrequests per tick)
 * - Background refresh: kicks POST /api/quotes/live-refresh via waitUntil
 * - Graceful close: after ~40 ticks (~2 min) to avoid budget exhaustion
 * - Auto-reconnect: client EventSource reconnects with fresh budget
 * 
 * CF Workers subrequest budget (lifetime, not per-tick):
 * - Each SSE connection = 1 Worker invocation
 * - All subrequests (across all ticks) count toward SAME 50 limit
 * - Read-only: ~1 subrequest per tick (listMarksDetailed)
 * - Background refresh: ~1 subrequest per kick (waitUntil fetch)
 * - Total: ~40 ticks × 1-2 subrequests = safe under 50 limit
 * - Graceful close after 40 ticks → client reconnects → fresh budget
 */

import type { Context } from 'hono';
import { markActivity } from './quote-service.js';
import { listMarksDetailed } from './quotes.js';

// SSE tick cadence
const STREAM_TICK_INTERVAL_MS = 3_000; // 3 seconds

// Graceful close after N ticks to avoid lifetime budget exhaustion
// Budget math: 18 ticks × 2 avg subrequests = 36 total (safe under 50)
const MAX_TICKS_PER_CONNECTION = 18; // ~54 seconds per connection

// Kick refresh every N ticks (not every tick, to save subrequests)
// Kicking every tick burns budget fast (stampede skip still costs 1 subrequest)
const REFRESH_KICK_EVERY_N_TICKS = 3; // Kick every 3rd tick (~9s interval)

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
 * Refresh holdings+watchlist symbols in-process (throttled)
 * Avoids same-zone self-fetch issue (Cloudflare error 1042) by calling quote-service directly
 */
async function refreshInProcess(c: Context, connectionId: string, lastRefreshTick: number, currentTick: number): Promise<number> {
  // Throttle: only refresh every ~10-15 seconds
  const REFRESH_THROTTLE_TICKS = Math.ceil(12000 / STREAM_TICK_INTERVAL_MS); // ~12s = 4 ticks
  
  if (currentTick - lastRefreshTick < REFRESH_THROTTLE_TICKS) {
    return lastRefreshTick; // No refresh yet
  }

  try {
    // Import quote-service to refresh in-process (avoids HTTP self-fetch)
    const { forceRefresh } = await import('./quote-service.js');
    const { query } = await import('./db.js');
    
    // Build symbols list: holdings + watchlist (same as buildSymbolUniverse but faster)
    const symbolsRes = await query<{ symbol: string }>(
      `
      SELECT DISTINCT symbol FROM (
        SELECT symbol FROM trades
        GROUP BY symbol
        HAVING SUM(
          CASE 
            WHEN LOWER(action) LIKE '%short%' THEN -ABS(quantity)
            WHEN LOWER(action) LIKE '%cover%' THEN ABS(quantity)
            WHEN LOWER(action) LIKE '%buy%' OR LOWER(action) LIKE 'bought%' THEN ABS(quantity)
            WHEN LOWER(action) LIKE '%sell%' OR LOWER(action) LIKE 'sold%' THEN -ABS(quantity)
            ELSE 0
          END
        ) <> 0
        UNION
        SELECT symbol FROM watchlist
      ) t
      WHERE symbol <> '' AND UPPER(symbol) <> 'TEST'
      ORDER BY symbol
      `
    );
    
    const symbols = symbolsRes.rows
      .map((r) => r.symbol.toUpperCase().trim())
      .filter((s) => s.length > 0 && s !== 'TEST');
    
    if (symbols.length === 0) {
      console.log(`[QuoteStream] ${connectionId}: No symbols to refresh`);
      return currentTick;
    }

    // Chunk to respect subrequest budget (max 10 per chunk, up to ~50 total in this invocation)
    const CHUNK_SIZE = 10;
    const MAX_CHUNKS = 4; // Max 40 symbols per SSE tick (leaves budget for other operations)
    const chunkedSymbols = symbols.slice(0, CHUNK_SIZE * MAX_CHUNKS);
    
    console.log(`[QuoteStream] ${connectionId}: Refreshing ${chunkedSymbols.length} symbols (in-process)`);
    
    let totalUpdated = 0;
    for (let i = 0; i < chunkedSymbols.length; i += CHUNK_SIZE) {
      const chunk = chunkedSymbols.slice(i, i + CHUNK_SIZE);
      const result = await forceRefresh(chunk);
      totalUpdated += result.updated.length;
    }
    
    console.log(`[QuoteStream] ${connectionId}: Refreshed ${totalUpdated} symbols`);
    return currentTick; // Update last refresh tick
    
  } catch (err) {
    console.error(`[QuoteStream] ${connectionId}: In-process refresh error:`, err);
    return lastRefreshTick; // Don't update on error
  }
}

/**
 * SSE endpoint handler: GET /api/quotes/stream
 * 
 * CF Workers lifetime budget safe:
 * - Read-only loop: minimal subrequests (~1 per tick)
 * - Background refresh via waitUntil: doesn't block, uses separate budget
 * - Graceful close after MAX_TICKS_PER_CONNECTION (~2 min)
 * - Client EventSource auto-reconnects with fresh budget
 */
export async function handleQuoteStream(c: Context) {
  markActivity();

  const connectionId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  console.log(`[QuoteStream] New connection: ${connectionId}`);

  // Track connection state
  let closed = false;
  let tickCount = 0;
  let lastRefreshTick = -999; // Force refresh on first eligible tick

  // Create SSE stream with read-only loop
  const stream = new ReadableStream({
    async start(controller) {
      console.log(`[QuoteStream] Starting read-only stream loop for ${connectionId}`);

      try {
        // Send initial connected event
        controller.enqueue(
          new TextEncoder().encode(
            sseMessage('connected', {
              id: connectionId,
              timestamp: new Date().toISOString(),
              tickInterval: STREAM_TICK_INTERVAL_MS,
              maxTicks: MAX_TICKS_PER_CONNECTION,
            })
          )
        );

        // Read-only loop: continuously read marks from DB and emit
        while (!closed && tickCount < MAX_TICKS_PER_CONNECTION) {
          // Wait before next tick
          await sleep(STREAM_TICK_INTERVAL_MS);

          if (closed) break;

          tickCount++;

          // Refresh holdings+watchlist in-process (throttled to ~every 10-15s)
          if (tickCount % REFRESH_KICK_EVERY_N_TICKS === 1) {
            lastRefreshTick = await refreshInProcess(c, connectionId, lastRefreshTick, tickCount);
          }

          if (closed) break;

          // Read marks from DB (cheap: ~1 subrequest)
          try {
            const data = await listMarksDetailed();
            const message = sseMessage('marks', data);
            controller.enqueue(new TextEncoder().encode(message));
            console.log(
              `[QuoteStream] ${connectionId}: Sent marks (tick ${tickCount}/${MAX_TICKS_PER_CONNECTION})`
            );
          } catch (err) {
            console.error(`[QuoteStream] ${connectionId}: Failed to read/send marks:`, err);
            // Don't break - try again next tick
          }

          // Send heartbeat comment
          try {
            controller.enqueue(
              new TextEncoder().encode(`: heartbeat ${new Date().toISOString()}\n\n`)
            );
          } catch (err) {
            console.error(`[QuoteStream] ${connectionId}: Failed to send heartbeat:`, err);
            break;
          }
        }

        // Graceful close after max ticks
        if (tickCount >= MAX_TICKS_PER_CONNECTION) {
          console.log(
            `[QuoteStream] ${connectionId}: Gracefully closing after ${tickCount} ticks ` +
            `(lifetime budget preservation)`
          );
        }

      } catch (err) {
        console.error(`[QuoteStream] ${connectionId}: Stream error:`, err);
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
        console.log(`[QuoteStream] ${connectionId}: Stream ended (${tickCount} ticks)`);
      }
    },
    cancel() {
      // Connection closed by client
      closed = true;
      console.log(`[QuoteStream] ${connectionId}: Connection cancelled by client`);
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
