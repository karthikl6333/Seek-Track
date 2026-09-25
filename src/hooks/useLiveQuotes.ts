/**
 * SSE live quote streaming hook
 * 
 * Usage:
 * - When enabled: opens EventSource to /api/quotes/stream
 * - Receives real-time mark updates (~3s interval)
 * - Auto-reconnects on connection loss
 * - Gracefully closes when disabled
 */

import { useEffect, useRef, useState } from 'react';
import type { MarkInfo } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

interface LiveQuotesData {
  marks: Record<string, MarkInfo>;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
}

interface UseLiveQuotesResult {
  connected: boolean;
  error: string | null;
  lastUpdate: string | null;
}

export function useLiveQuotes(
  enabled: boolean,
  onUpdate: (data: LiveQuotesData) => void
): UseLiveQuotesResult {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setConnected(false);
      setError(null);
      return;
    }

    // Create SSE connection
    const connectSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      console.log('[LiveQuotes] Connecting to SSE stream...');
      const es = new EventSource(`${API_BASE}/api/quotes/stream`);
      eventSourceRef.current = es;

      es.addEventListener('connected', (e) => {
        console.log('[LiveQuotes] Connected:', e.data);
        setConnected(true);
        setError(null);
      });

      es.addEventListener('marks', (e) => {
        try {
          const data = JSON.parse(e.data) as LiveQuotesData;
          onUpdate(data);
          setLastUpdate(new Date().toISOString());
          setError(null);
        } catch (err) {
          console.error('[LiveQuotes] Failed to parse marks update:', err);
          setError('Failed to parse update');
        }
      });

      es.addEventListener('error', () => {
        console.warn('[LiveQuotes] Connection error, will retry...');
        setConnected(false);
        es.close();
        eventSourceRef.current = null;

        // Exponential backoff: retry after 3s
        if (reconnectTimeoutRef.current === null) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (enabled) {
              connectSSE();
            }
          }, 3000);
        }
      });

      es.addEventListener('open', () => {
        console.log('[LiveQuotes] Stream opened');
      });
    };

    connectSSE();

    // Cleanup
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [enabled, onUpdate]);

  return { connected, error, lastUpdate };
}
