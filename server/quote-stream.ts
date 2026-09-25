/**
 * Server-Sent Events (SSE) live quote streaming
 * 
 * Design:
 * - Single shared Yahoo refresh loop (2-5s interval) when ≥1 client connected
 * - Fan-out: one fetch → broadcast to all SSE connections
 * - Auto teardown: stop Yahoo loop when last connection closes
 * - Universe: same symbols as regular refresh (holdings + watchlist + research)
 * - Auth: HTTP Basic via EventSource credentials
 */

import type { Context } from 'hono';
import { forceRefresh, getSymbolUniverse, markActivity } from './quote-service.js';
import { listMarksDetailed } from './quotes.js';

// SSE refresh cadence: faster than 30s polling, but not excessive for Yahoo quota
const STREAM_REFRESH_INTERVAL_MS = 3_000; // 3 seconds

interface SSEConnection {
  id: string;
  controller: ReadableStreamDefaultController;
  closed: boolean;
}

// Track active SSE connections
const activeConnections = new Map<string, SSEConnection>();
let refreshLoopHandle: NodeJS.Timeout | null = null;
let lastStreamRefreshAt: string | null = null;

/**
 * Generate SSE message format
 */
function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Broadcast marks update to all connected clients
 */
async function broadcastMarksUpdate(): Promise<void> {
  if (activeConnections.size === 0) return;

  try {
    // Get symbol universe (same as regular refresh)
    const universe = await getSymbolUniverse();
    
    if (universe.length === 0) {
      console.log('[QuoteStream] Empty universe, skipping refresh');
      return;
    }

    // Chunk refresh to stay under CF Workers limits (10 symbols per call)
    const CHUNK_SIZE = 10;
    for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
      const chunk = universe.slice(i, i + CHUNK_SIZE);
      await forceRefresh(chunk);
    }

    // Get updated marks
    const data = await listMarksDetailed();
    lastStreamRefreshAt = data.lastRefreshAt;

    // Broadcast to all active connections
    const message = sseMessage('marks', data);
    const deadConnections: string[] = [];

    for (const [id, conn] of activeConnections.entries()) {
      if (conn.closed) {
        deadConnections.push(id);
        continue;
      }

      try {
        conn.controller.enqueue(new TextEncoder().encode(message));
      } catch (err) {
        console.error(`[QuoteStream] Failed to send to ${id}:`, err);
        conn.closed = true;
        deadConnections.push(id);
      }
    }

    // Clean up dead connections
    for (const id of deadConnections) {
      activeConnections.delete(id);
      console.log(`[QuoteStream] Removed dead connection ${id} (${activeConnections.size} remaining)`);
    }

    // Stop refresh loop if no connections remain
    if (activeConnections.size === 0) {
      stopRefreshLoop();
    }
  } catch (err) {
    console.error('[QuoteStream] Broadcast error:', err);
  }
}

/**
 * Start the shared refresh loop
 */
function startRefreshLoop(): void {
  if (refreshLoopHandle !== null) {
    return; // Already running
  }

  console.log(`[QuoteStream] Starting refresh loop (${STREAM_REFRESH_INTERVAL_MS}ms interval)`);

  // Initial refresh after 500ms
  setTimeout(() => {
    void broadcastMarksUpdate();
  }, 500);

  refreshLoopHandle = setInterval(() => {
    void broadcastMarksUpdate();
  }, STREAM_REFRESH_INTERVAL_MS);
}

/**
 * Stop the shared refresh loop
 */
function stopRefreshLoop(): void {
  if (refreshLoopHandle !== null) {
    clearInterval(refreshLoopHandle);
    refreshLoopHandle = null;
    console.log('[QuoteStream] Stopped refresh loop (no active connections)');
  }
}

/**
 * SSE endpoint handler: GET /api/quotes/stream
 */
export async function handleQuoteStream(c: Context) {
  markActivity();

  const connectionId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  console.log(`[QuoteStream] New connection: ${connectionId}`);

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      // Register connection
      const conn: SSEConnection = {
        id: connectionId,
        controller,
        closed: false,
      };
      activeConnections.set(connectionId, conn);
      console.log(`[QuoteStream] Active connections: ${activeConnections.size}`);

      // Send initial heartbeat
      try {
        controller.enqueue(
          new TextEncoder().encode(
            sseMessage('connected', {
              id: connectionId,
              timestamp: new Date().toISOString(),
              refreshInterval: STREAM_REFRESH_INTERVAL_MS,
            })
          )
        );
      } catch (err) {
        console.error(`[QuoteStream] Failed to send initial message:`, err);
      }

      // Start refresh loop if this is the first connection
      if (activeConnections.size === 1) {
        startRefreshLoop();
      }
    },
    cancel() {
      // Connection closed by client
      const conn = activeConnections.get(connectionId);
      if (conn) {
        conn.closed = true;
        activeConnections.delete(connectionId);
        console.log(`[QuoteStream] Connection closed: ${connectionId} (${activeConnections.size} remaining)`);

        // Stop refresh loop if no connections remain
        if (activeConnections.size === 0) {
          stopRefreshLoop();
        }
      }
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

/**
 * Get stream status (for debugging/monitoring)
 */
export function getStreamStatus() {
  return {
    activeConnections: activeConnections.size,
    isRefreshing: refreshLoopHandle !== null,
    lastRefreshAt: lastStreamRefreshAt,
    refreshInterval: STREAM_REFRESH_INTERVAL_MS,
  };
}
