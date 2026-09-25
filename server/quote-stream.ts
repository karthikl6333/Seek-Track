/**
 * Server-Sent Events (SSE) live quote streaming - Cloudflare Workers compatible
 * 
 * Design (CF-safe):
 * - Per-connection async loop INSIDE the ReadableStream
 * - Each connection continuously writes response bytes (avoids CF hang detector)
 * - Async sleep using setTimeout + Promise (CF Workers compatible)
 * - No shared setInterval (incompatible with CF isolate model)
 * - Auto teardown: loop stops when connection closes
 * 
 * Tradeoffs:
 * - Each connection has its own refresh loop (not shared across isolates)
 * - Yahoo quota scales with concurrent connections (mitigated by chunking + 3s interval)
 * - Simple, robust, no Durable Objects needed
 */

import type { Context } from 'hono';
import { forceRefresh, getSymbolUniverse, markActivity } from './quote-service.js';
import { listMarksDetailed } from './quotes.js';

// SSE refresh cadence: faster than 30s polling, but not excessive for Yahoo quota
const STREAM_REFRESH_INTERVAL_MS = 3_000; // 3 seconds

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
 * Fetch and return marks update
 */
async function fetchMarksUpdate(): Promise<{
  marks: Record<string, import('./quotes.js').MarkInfo>;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
} | null> {
  try {
    // Get symbol universe (same as regular refresh)
    const universe = await getSymbolUniverse();
    
    if (universe.length === 0) {
      console.log('[QuoteStream] Empty universe, skipping refresh');
      return null;
    }

    // Chunk refresh to stay under CF Workers limits (10 symbols per call)
    const CHUNK_SIZE = 10;
    for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
      const chunk = universe.slice(i, i + CHUNK_SIZE);
      await forceRefresh(chunk);
    }

    // Get updated marks
    const data = await listMarksDetailed();
    return data;
  } catch (err) {
    console.error('[QuoteStream] Fetch marks error:', err);
    return null;
  }
}

/**
 * SSE endpoint handler: GET /api/quotes/stream
 * 
 * CF Workers compatible: uses per-connection async loop inside ReadableStream
 * to continuously generate response bytes (avoids hang detector)
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

        // Per-connection async loop: continuously fetch and broadcast
        // This keeps the response active and avoids CF hang detector
        while (!closed) {
          // Wait before next refresh
          await sleep(STREAM_REFRESH_INTERVAL_MS);

          if (closed) break;

          // Fetch marks update
          const data = await fetchMarksUpdate();

          if (closed) break;

          if (data) {
            // Send marks event
            try {
              const message = sseMessage('marks', data);
              controller.enqueue(new TextEncoder().encode(message));
              console.log(`[QuoteStream] Sent marks update to ${connectionId}`);
            } catch (err) {
              console.error(`[QuoteStream] Failed to send marks to ${connectionId}:`, err);
              break;
            }
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
