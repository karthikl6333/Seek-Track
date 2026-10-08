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
import { listMarksDetailed, listMarksDetailedIncremental } from './quotes.js';

// SSE tick cadence (D1 optimization: slower = fewer reads)
const STREAM_TICK_INTERVAL_MS = 5_000; // 5 seconds

// Graceful close after N ticks to avoid lifetime budget exhaustion
// Budget math: 40 ticks × 1 subrequest (read marks) = 40 total (safe under 50)
const MAX_TICKS_PER_CONNECTION = 40; // ~3.3 minutes per connection

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
  let lastCursor: string | null = null; // Track last updated_at for incremental reads

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
              // 2 = full `marks` snapshot on connect, then `marks-delta` events with changed rows only
              protocol: 2,
            })
          )
        );

        // Snapshot-on-connect: the FULL marks set goes out immediately as `marks` (every connect
        // and every reconnect). Afterwards only changed rows go out, as a separate `marks-delta`
        // event. Old client bundles only listen for `marks` and REPLACE their price map with it,
        // so they must never receive a partial payload under that name (that blanked prices for
        // tabs still running the pre-D1 build). Empty deltas are not sent at all.
        const sent = new Map<string, string>(); // symbol -> updatedAt already delivered
        const enqueue = (event: string, payload: unknown) =>
          controller.enqueue(new TextEncoder().encode(sseMessage(event, payload)));

        const sendSnapshot = async () => {
          const data = await listMarksDetailed();
          sent.clear();
          for (const [sym, m] of Object.entries(data.marks)) sent.set(sym, m.updatedAt);
          lastCursor = data.lastRefreshAt;
          enqueue('marks', { ...data, incremental: false, snapshot: true });
          console.log(`[QuoteStream] ${connectionId}: snapshot sent (${Object.keys(data.marks).length} marks)`);
        };

        try {
          await sendSnapshot();
        } catch (err) {
          console.error(`[QuoteStream] ${connectionId}: initial snapshot failed:`, err);
        }

        while (!closed && tickCount < MAX_TICKS_PER_CONNECTION) {
          await sleep(STREAM_TICK_INTERVAL_MS);
          if (closed) break;
          tickCount++;

          try {
            if (!lastCursor) {
              // Snapshot failed earlier (or DB was empty): retry the full read.
              await sendSnapshot();
            } else {
              const data = await listMarksDetailedIncremental(lastCursor);
              if (data.lastRefreshAt) lastCursor = data.lastRefreshAt;
              // De-duplicate rows re-read by the cursor look-back window.
              const changed: Record<string, (typeof data.marks)[string]> = {};
              for (const [sym, m] of Object.entries(data.marks)) {
                if (sent.get(sym) !== m.updatedAt) {
                  changed[sym] = m;
                  sent.set(sym, m.updatedAt);
                }
              }
              if (Object.keys(changed).length > 0) {
                enqueue('marks-delta', { ...data, marks: changed, incremental: true });
              }
            }
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
