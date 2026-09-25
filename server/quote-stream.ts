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
 * Kick background refresh via fetch (uses waitUntil for non-blocking)
 * Returns true if kick was attempted, false if skipped
 */
async function kickBackgroundRefresh(c: Context, connectionId: string): Promise<boolean> {
  try {
    // Build absolute URL for internal fetch
    const url = new URL('/api/quotes/live-refresh', c.req.url);
    
    // Forward auth headers
    const authHeader = c.req.header('Authorization');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    // Kick refresh in background (non-blocking)
    // This costs 1 subrequest on the SSE side; the child invocation spends Yahoo budget
    const refreshPromise = fetch(url.toString(), {
      method: 'POST',
      headers,
    }).then(async (res) => {
      if (res.ok) {
        const data = await res.json() as { skipped?: boolean; updated?: string[] };
        if (data.skipped) {
          console.log(`[QuoteStream] ${connectionId}: Refresh skipped (recent)`);
        } else {
          console.log(`[QuoteStream] ${connectionId}: Refresh completed (${data.updated?.length || 0} symbols)`);
        }
      } else {
        console.warn(`[QuoteStream] ${connectionId}: Refresh failed: ${res.status}`);
      }
    }).catch((err) => {
      console.error(`[QuoteStream] ${connectionId}: Refresh error:`, err);
    });

    // Use waitUntil if available (CF Workers / Pages)
    if (c.executionCtx && 'waitUntil' in c.executionCtx) {
      c.executionCtx.waitUntil(refreshPromise);
    } else {
      // Fallback: fire and forget (Node.js dev)
      void refreshPromise;
    }

    return true;
  } catch (err) {
    console.error(`[QuoteStream] ${connectionId}: Failed to kick refresh:`, err);
    return false;
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

          // Kick background refresh every Nth tick (rate-limited, non-blocking)
          if (tickCount % REFRESH_KICK_EVERY_N_TICKS === 1) {
            await kickBackgroundRefresh(c, connectionId);
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
