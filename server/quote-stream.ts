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
// Budget math: 40 ticks × 1 subrequest (read marks) = 40 total (safe under 50)
const MAX_TICKS_PER_CONNECTION = 40; // ~2 minutes per connection

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

  // Create SSE stream with read-only loop (CLIENT drives refreshes, not SSE)
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
        // CLIENT drives refreshes via HTTP (each HTTP request = fresh 50-subrequest budget)
        // This SSE connection only READS marks (~1 subrequest per tick, 40 ticks = safe under 50)
        while (!closed && tickCount < MAX_TICKS_PER_CONNECTION) {
          // Wait before next tick
          await sleep(STREAM_TICK_INTERVAL_MS);

          if (closed) break;

          tickCount++;

          // Read marks from DB (cheap: ~1 subrequest per tick)
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
