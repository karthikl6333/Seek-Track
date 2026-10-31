import { useCallback, useRef, type MutableRefObject } from 'react';
import { PAPER_SYNCED_EVENT, paperSyncTargets, type PaperBook } from '../lib/pollGate';
import { refreshPaperData, refreshCryptoPaperLivePnl, refreshPaperFlexData } from '../api/client';
import type { Store } from './useStore';

const PAPER_SYNC: Record<PaperBook, () => Promise<unknown>> = {
  paper: () => refreshPaperData(),
  cryptoPaper: () => refreshCryptoPaperLivePnl(),
  paperFlex: () => refreshPaperFlexData(),
};

/** Throttled background Alpaca sync for whichever paper book is on screen. */
export function usePaperSync(storeRef: MutableRefObject<Store>) {
  const lastPaperSyncRef = useRef<number | null>(null);

  /**
   * Background Alpaca sync for the paper books on screen only, at most every 5 min (was: all three
   * books on every 30s cycle, each followed by summary re-reads). Fires PAPER_SYNCED_EVENT so the
   * visible summary cards re-read once.
   */
  const maybeSyncPaper = useCallback(async () => {
    const targets = paperSyncTargets(storeRef.current.view, {
      hidden: document.hidden,
      nowMs: Date.now(),
      lastSyncMs: lastPaperSyncRef.current,
    });
    if (targets.length === 0) return;
    lastPaperSyncRef.current = Date.now();
    await Promise.allSettled(targets.map((t) => PAPER_SYNC[t]()));
    window.dispatchEvent(new CustomEvent(PAPER_SYNCED_EVENT, { detail: { books: targets } }));
  }, []);

  /** Manual refresh: sync the on-screen paper books on the next maybeSyncPaper() call. */
  const resetPaperSync = useCallback(() => {
    lastPaperSyncRef.current = null;
  }, []);

  return { maybeSyncPaper, resetPaperSync };
}
