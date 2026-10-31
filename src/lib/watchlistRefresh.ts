import { refreshInChunks } from './chunkedRefresh';

/** Max symbols per HTTP request (each request gets its own Cloudflare subrequest budget). */
export const WATCHLIST_CHUNK_SIZE = 10;

/** What POST /api/watchlist/refresh returns for one chunk (extra fields ignored). */
export interface WatchlistChunkResult {
  ok?: boolean;
  error?: string;
  updated?: string[];
  failed?: string[];
  stale?: string[];
  refreshedAt?: string;
}

export interface WatchlistRefreshSummary {
  /** True when at least one chunk got a good response. */
  ok: boolean;
  updated: string[];
  failed: string[];
  chunksOk: number;
  chunksTotal: number;
  /** First chunk error (thrown or reported by the server), for the error line. */
  error: string | null;
  refreshedAt: string | null;
}

/** A chunk response counts only when it came back ok and without a server-reported error. */
function chunkSucceeded(r: WatchlistChunkResult | null | undefined): boolean {
  return !!r && r.ok !== false && !r.error;
}

/**
 * Refresh the watchlist in chunks of <= 10 symbols and combine the results. A failing chunk is
 * recorded and skipped (the rest still run), so the last known prices of that chunk stay on screen.
 * `onProgress(done, total)` fires before the first chunk and after every chunk (done counts chunks).
 */
export async function refreshWatchlistInChunks(
  symbols: string[],
  refreshChunk: (chunk: string[]) => Promise<WatchlistChunkResult>,
  onProgress?: (done: number, total: number) => void,
  chunkSize: number = WATCHLIST_CHUNK_SIZE,
): Promise<WatchlistRefreshSummary> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const total = Math.ceil(unique.length / chunkSize);
  const summary: WatchlistRefreshSummary = {
    ok: false,
    updated: [],
    failed: [],
    chunksOk: 0,
    chunksTotal: total,
    error: null,
    refreshedAt: null,
  };
  if (total === 0) return { ...summary, ok: true };

  let done = 0;
  onProgress?.(0, total);
  summary.ok = await refreshInChunks(
    unique,
    chunkSize,
    'Watchlist',
    async (chunk) => {
      try {
        const res = await refreshChunk(chunk);
        summary.updated.push(...(res.updated ?? []));
        summary.failed.push(...(res.failed ?? []));
        if (chunkSucceeded(res)) {
          summary.chunksOk += 1;
          if (res.refreshedAt) summary.refreshedAt = res.refreshedAt;
        } else {
          summary.error ??= res.error ?? 'Refresh failed';
        }
        return res;
      } catch (e) {
        summary.error ??= e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        done += 1;
        onProgress?.(done, total);
      }
    },
    chunkSucceeded,
  );
  return summary;
}
