/**
 * Client-side poll gating (D1 read budget). Pure / timer-injectable so it can be unit-tested.
 */

export type PaperBook = 'paper' | 'cryptoPaper' | 'paperFlex';

/** Background Alpaca sync for paper books: at most this often, and only for what's on screen. */
export const PAPER_SYNC_MIN_MS = 5 * 60_000;

/** Window event fired after a background paper sync so on-screen summaries re-read once. */
export const PAPER_SYNCED_EVENT = 'seektrack:paper-synced';

/**
 * Which paper books the periodic cycle may sync now. Overview shows all three P&L cards; each
 * paper tab shows its own book; every other view (and a hidden tab) syncs nothing.
 */
export function paperSyncTargets(
  view: string,
  opts: { hidden: boolean; nowMs: number; lastSyncMs: number | null; minMs?: number },
): PaperBook[] {
  if (opts.hidden) return [];
  const minMs = opts.minMs ?? PAPER_SYNC_MIN_MS;
  if (opts.lastSyncMs !== null && opts.nowMs - opts.lastSyncMs < minMs) return [];
  if (view === 'overview') return ['paper', 'cryptoPaper', 'paperFlex'];
  if (view === 'paper' || view === 'cryptoPaper' || view === 'paperFlex') return [view];
  return [];
}

/**
 * Leading + trailing throttle: runs `fn` now if allowed, otherwise once at the end of the window
 * (extra calls inside the window collapse into that one trailing run).
 */
export function createThrottle(
  minMs: number,
  fn: () => void,
  deps: {
    now?: () => number;
    setTimer?: (cb: () => void, ms: number) => unknown;
    clearTimer?: (h: unknown) => void;
  } = {},
): { call: () => void; cancel: () => void } {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let last = Number.NEGATIVE_INFINITY;
  let pending: unknown = null;
  const run = () => {
    pending = null;
    last = now();
    fn();
  };
  return {
    call() {
      const wait = last + minMs - now();
      if (wait <= 0 && pending === null) return run();
      if (pending === null) pending = setTimer(run, Math.max(0, wait));
    },
    cancel() {
      if (pending !== null) clearTimer(pending);
      pending = null;
    },
  };
}

/** Tiny TTL memo for an async value (e.g. watchlist symbols when the Watchlist isn't mounted). */
export function createTtlValue<T>(ttlMs: number, load: () => Promise<T>, now: () => number = () => Date.now()) {
  let value: T | undefined;
  let at = Number.NEGATIVE_INFINITY;
  return {
    async get(): Promise<T> {
      if (value !== undefined && now() - at < ttlMs) return value;
      value = await load();
      at = now();
      return value;
    },
    invalidate() {
      value = undefined;
    },
  };
}
