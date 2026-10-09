import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../lib/db';
import { calcWhatIf, computePositions, type LotEngineResult } from '../lib/lots';
import { flattenMarks, mergeMarkDetails } from '../lib/marks';
import { checkedAtAfter, newestMarkStamp } from '../lib/refreshStamp';
import type {
  AppSettings,
  CalculatorState,
  ImportResult,
  JournalEntry,
  ManualTradeInput,
  MarkInfo,
  PairResolveResult,
  Trade,
  ViewId,
} from '../types';

const defaultCalc: CalculatorState = {
  symbol: '',
  quantity: 100,
  entryPrice: 0,
  fees: 0,
  targetPrice: 0,
};

type CalcSlot = 'A' | 'B';

const VALID_VIEWS: ViewId[] = [
  'overview',
  'positions',
  'trades',
  'charges',
  'charts',
  'research',
  'paper',
  'cryptoPaper',
];

function viewFromLocation(): ViewId {
  const raw = (window.location.hash || '').replace(/^#\/?/, '').split(/[/?#]/)[0];
  if (VALID_VIEWS.includes(raw as ViewId)) return raw as ViewId;
  return 'overview';
}

function writeViewHash(view: ViewId): void {
  const next = `#${view}`;
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', next);
  }
}

export function useStore() {
  const [ready, setReady] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [marks, setMarks] = useState<Record<string, number>>({});
  const [markDetails, setMarkDetails] = useState<Record<string, MarkInfo>>({});
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  /** Client time of the last successful refresh response (moves even when no price changed). */
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastRefreshError, setLastRefreshError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [view, setViewState] = useState<ViewId>(() => viewFromLocation());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [calcA, setCalcA] = useState<CalculatorState>(defaultCalc);
  const [calcB, setCalcB] = useState<CalculatorState>(defaultCalc);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [resolvedPairA, setResolvedPairA] = useState<PairResolveResult | null>(null);
  const [resolvedPairB, setResolvedPairB] = useState<PairResolveResult | null>(null);
  const [pairBusyA, setPairBusyA] = useState(false);
  const [pairBusyB, setPairBusyB] = useState(false);

  const setView = useCallback((next: ViewId) => {
    setViewState(next);
    writeViewHash(next);
  }, []);

  useEffect(() => {
    writeViewHash(view);
    const onHashChange = () => {
      const fromHash = viewFromLocation();
      setViewState((cur) => (cur === fromHash ? cur : fromHash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [view]);

  /**
   * Single entry point for any marks payload (REST full read, SSE snapshot, SSE delta).
   * Always MERGES: a symbol missing from the payload, or carrying a null/0 price, keeps its last
   * known price. Prices therefore never go blank once known, whatever the server or a stale
   * client/server version combination sends.
   */
  const ingestMarks = useCallback((incoming: Record<string, MarkInfo> | null | undefined) => {
    setMarkDetails((prev) => {
      const next = mergeMarkDetails(prev, incoming);
      if (next !== prev) setMarks(flattenMarks(next));
      return next;
    });
  }, []);

  // Newest updatedAt we hold: lets refreshMarks ask the server for a delta (?since=) instead of
  // the whole marks table. Full read only on first load (or with { full: true }).
  const markCursorRef = useRef<string | null>(null);
  useEffect(() => {
    markCursorRef.current = newestMarkStamp(markDetails);
  }, [markDetails]);

  const refreshMarks = useCallback(async (opts?: { full?: boolean }) => {
    const since = opts?.full ? null : markCursorRef.current;
    const detailed = await db.loadMarksDetailed(since);
    ingestMarks(detailed.marks);
    if (detailed.lastRefreshAt) setLastRefreshAt(detailed.lastRefreshAt);
    setLastRefreshError(detailed.lastRefreshError);
  }, [ingestMarks]);

  const applyMarksUpdate = useCallback((data: {
    marks: Record<string, MarkInfo>;
    lastRefreshAt: string | null;
    lastRefreshError: string | null;
    incremental?: boolean;
  }) => {
    // Snapshot or delta: both merge (see ingestMarks). Never replace the map.
    ingestMarks(data.marks);
    if (data.lastRefreshAt) setLastRefreshAt(data.lastRefreshAt);
    setLastRefreshError(data.lastRefreshError);
  }, [ingestMarks]);

  /**
   * Full reload (trades, settings, journal, pairs, marks). Only on load, after this client's own
   * writes (fresh: bypass the server's per-isolate trades cache) and on manual refresh. The
   * periodic price cycles call refreshMarks() instead (D1 read budget).
   */
  const refresh = useCallback(async (opts?: { fresh?: boolean }) => {
    try {
      const [t, s, j, pairCache] = await Promise.all([
        db.loadAllTrades({ fresh: opts?.fresh }),
        db.loadSettings({ fresh: opts?.fresh }),
        db.loadJournal(),
        db.listPairCache({ fresh: opts?.fresh }).catch(() => ({ pairs: [] as import('../types').PairDef[] })),
      ]);
      setTrades(t);
      // Merge pair_cache into settings.pairs so CrossCheck is not limited to seeds
      const byEtf = new Map(s.pairs.map((p) => [p.etf.toUpperCase(), p]));
      for (const p of pairCache.pairs ?? []) {
        if (!byEtf.has(p.etf.toUpperCase())) byEtf.set(p.etf.toUpperCase(), p);
      }
      setSettings({ ...s, pairs: Array.from(byEtf.values()) });
      setJournal(j);
      await refreshMarks(opts?.fresh ? { full: true } : undefined);
      setReady(true);
      setAuthError(false);
    } catch (e) {
      if (e instanceof db.AuthError) {
        setAuthError(true);
        setError('Authentication required. Please log in again.');
      } else {
        throw e;
      }
    }
  }, [refreshMarks]);

  useEffect(() => {
    refresh().catch((e) => {
      if (e instanceof db.AuthError) {
        // Auth error already handled in refresh()
        return;
      }
      setError(String(e));
    });
  }, [refresh]);

  const analysis: LotEngineResult | null = useMemo(() => {
    if (!settings) return null;
    return computePositions(trades, settings.themes, marks);
  }, [trades, settings, marks]);

  const whatIfA = useMemo(() => calcWhatIf(calcA), [calcA]);
  const whatIfB = useMemo(() => calcWhatIf(calcB), [calcB]);

  const importCsvText = useCallback(
    async (text: string, overrideManual = true) => {
      setError(null);
      const finalResult = await db.importCsvText(text, overrideManual);
      setImportResult(finalResult);
      await refresh({ fresh: true });
      return finalResult;
    },
    [refresh],
  );

  const addManualTrade = useCallback(
    async (input: ManualTradeInput) => {
      setError(null);
      const result = await db.addManualTrade(input);
      await refresh({ fresh: true });
      return result;
    },
    [refresh],
  );

  const setMarkPrice = useCallback(
    async (symbol: string, price: number) => {
      await db.setMark(symbol, price);
      await refreshMarks();
    },
    [refreshMarks],
  );

  const refreshLiveQuotes = useCallback(
    async (extra?: string[], options?: { includeHoldings?: boolean }) => {
      setError(null);
      setLastRefreshError(null);
      
      const includeHoldings = options?.includeHoldings ?? true;
      
      // Build symbol list
      const symbols = [...(extra ?? [])];
      if (calcA.symbol) symbols.push(calcA.symbol);
      if (calcB.symbol) symbols.push(calcB.symbol);
      
      // When a pair is known, always refresh BOTH etf and underlying
      const pairA = resolvedPairA?.pair;
      const pairB = resolvedPairB?.pair;
      if (pairA) {
        symbols.push(pairA.etf, pairA.underlying);
      } else if (settings) {
        const symA = calcA.symbol.trim().toUpperCase();
        const foundA = settings.pairs.find(
          (p) => p.etf.toUpperCase() === symA || p.underlying.toUpperCase() === symA,
        );
        if (foundA) symbols.push(foundA.etf, foundA.underlying);
      }
      if (pairB) {
        symbols.push(pairB.etf, pairB.underlying);
      } else if (settings) {
        const symB = calcB.symbol.trim().toUpperCase();
        const foundB = settings.pairs.find(
          (p) => p.etf.toUpperCase() === symB || p.underlying.toUpperCase() === symB,
        );
        if (foundB) symbols.push(foundB.etf, foundB.underlying);
      }
      
      // Include open positions only if requested (default true)
      // Bug fix: when refreshing full universe, holdings are included once at the top level
      const open = includeHoldings
        ? (analysis?.positions.filter((p) => p.quantity !== 0).map((p) => p.symbol) ?? [])
        : [];
      
      // Exclude empty symbols and 'TEST' (Bug 7)
      let universe = [...new Set([...symbols, ...open]
        .map((s) => s.toUpperCase().trim())
        .filter((s) => s.length > 0 && s !== 'TEST')
      )];
      
      try {
        // If no symbols, get universe
        if (universe.length === 0) {
          const { symbols: universeSymbols } = await db.getQuoteUniverse();
          universe = universeSymbols.filter((s) => s !== 'TEST' && s.length > 0);
        }
        
        // Chunk at client level (never send >10 symbols to server). A failing chunk does not
        // abort the others, and marks are always re-read (merged) afterwards, so a failed
        // refresh just leaves the last known prices on screen.
        const CHUNK_SIZE = 10;
        const allResults: Awaited<ReturnType<typeof db.refreshQuotes>>[] = [];
        let firstError: unknown = null;

        for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
          const chunk = universe.slice(i, i + CHUNK_SIZE);
          try {
            const result = await db.refreshQuotes(chunk);
            if (result.needsChunking && result.universe) {
              universe = result.universe.filter((s) => s !== 'TEST' && s.length > 0);
              continue;
            }
            allResults.push(result);
          } catch (chunkErr) {
            if (chunkErr instanceof db.AuthError) throw chunkErr;
            firstError ??= chunkErr;
            console.warn('[Store] quote refresh chunk failed; keeping last known prices', chunkErr);
          }
        }

        try {
          await refreshMarks();
        } catch (readErr) {
          firstError ??= readErr;
        }

        if (firstError && allResults.length === 0) {
          // Nothing refreshed: surface a small error badge; prices stay as they were.
          setLastRefreshError(String(firstError));
        }

        // Return aggregated result
        const aggregated = {
          ok: allResults.some(r => r.ok),
          updated: allResults.flatMap(r => r.updated),
          failed: allResults.flatMap(r => r.failed),
          stale: allResults.flatMap(r => r.stale ?? []),
          refreshedAt: allResults[allResults.length - 1]?.refreshedAt ?? new Date().toISOString(),
          total: universe.length,
        };

        // A successful check advances "last checked" even if the server skipped all row writes
        // because nothing changed. A refresh with no successful response leaves it alone.
        if (allResults.length > 0) {
          const at = new Date();
          setLastCheckedAt((prev) => checkedAtAfter(prev, aggregated, at));
        }

        return aggregated;
      } catch (err) {
        setLastRefreshError(String(err));
        throw err;
      }
    },
    [analysis, calcA.symbol, calcB.symbol, refreshMarks, resolvedPairA, resolvedPairB, settings],
  );

  const loadPositionIntoCalc = useCallback(
    (symbol: string, slot: CalcSlot = 'A') => {
      const pos = analysis?.positions.find((p) => p.symbol === symbol);
      if (!pos) return;
      const newCalc = {
        symbol: pos.symbol,
        quantity: pos.quantity,
        entryPrice: Number(pos.avgCost.toFixed(4)),
        fees: 0,
        targetPrice: pos.markPrice ?? Number(pos.avgCost.toFixed(4)),
      };
      if (slot === 'A') {
        setCalcA(newCalc);
      } else {
        setCalcB(newCalc);
      }
    },
    [analysis],
  );

  const resolveCalcPair = useCallback(async (slot: CalcSlot, symbol?: string) => {
    const calc = slot === 'A' ? calcA : calcB;
    const setResolvedPair = slot === 'A' ? setResolvedPairA : setResolvedPairB;
    const setPairBusy = slot === 'A' ? setPairBusyA : setPairBusyB;
    
    const sym = (symbol ?? calc.symbol).trim().toUpperCase();
    if (!sym) {
      setResolvedPair(null);
      return null;
    }
    setPairBusy(true);
    try {
      const result = await db.resolvePair(sym);
      setResolvedPair(result);
      // Merge discovered pair into local settings view if missing
      if (result.pair && settings) {
        const exists = settings.pairs.some(
          (p) => p.etf.toUpperCase() === result.pair!.etf.toUpperCase(),
        );
        if (!exists) {
          const next = {
            ...settings,
            pairs: [...settings.pairs, result.pair],
            hiddenSymbols: settings.hiddenSymbols ?? [],
          };
          setSettings(next);
        }
      }
      // Refresh quotes for BOTH etf and underlying when pair resolves
      if (result.pair) {
        try {
          await db.refreshQuotes([result.pair.etf, result.pair.underlying, sym]);
          await refreshMarks();
        } catch (e) {
          console.warn('pair quote refresh failed', e);
        }
      }
      return result;
    } catch (e) {
      setResolvedPair({ pair: null, as: 'unknown', message: String(e) });
      return null;
    } finally {
      setPairBusy(false);
    }
  }, [calcA, calcB, settings, refreshMarks]);

  // Auto-resolve when calculator symbol changes
  useEffect(() => {
    const symA = calcA.symbol.trim().toUpperCase();
    if (!symA) {
      setResolvedPairA(null);
      return;
    }
    const t = setTimeout(() => {
      void resolveCalcPair('A', symA);
    }, 400);
    return () => clearTimeout(t);
  }, [calcA.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const symB = calcB.symbol.trim().toUpperCase();
    if (!symB) {
      setResolvedPairB(null);
      return;
    }
    const t = setTimeout(() => {
      void resolveCalcPair('B', symB);
    }, 400);
    return () => clearTimeout(t);
  }, [calcB.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveJournal = useCallback(
    async (entry: JournalEntry) => {
      await db.saveJournalEntry(entry);
      await refresh({ fresh: true });
    },
    [refresh],
  );

  const removeJournal = useCallback(
    async (id: string) => {
      await db.deleteJournalEntry(id);
      await refresh({ fresh: true });
    },
    [refresh],
  );

  const updateSettings = useCallback(
    async (next: AppSettings) => {
      await db.saveSettings(next);
      await refresh({ fresh: true });
    },
    [refresh],
  );

  const updateNote = useCallback(
    async (id: string, note: string) => {
      await db.updateTradeNote(id, note);
      await refresh({ fresh: true });
    },
    [refresh],
  );

  const toggleHiddenSymbol = useCallback(
    async (symbol: string) => {
      if (!settings) return;
      const sym = symbol.toUpperCase();
      const current = new Set((settings.hiddenSymbols ?? []).map((s) => s.toUpperCase()));
      if (current.has(sym)) current.delete(sym);
      else current.add(sym);
      const nextSettings = {
        ...settings,
        hiddenSymbols: Array.from(current).sort(),
      };
      // Update local state immediately for instant UI feedback
      setSettings(nextSettings);
      // Then persist to server
      await updateSettings(nextSettings);
    },
    [settings, updateSettings],
  );

  const hiddenSet = useMemo(
    () => new Set((settings?.hiddenSymbols ?? []).map((s) => s.toUpperCase())),
    [settings],
  );

  // Memoize the return object to prevent re-render loops
  // Functions are already stable via useCallback, but the object itself must be stable
  return useMemo(() => ({
    ready,
    error,
    authError,
    trades,
    marks,
    markDetails,
    lastRefreshAt,
    lastCheckedAt,
    lastRefreshError,
    settings,
    journal,
    view,
    setView,
    importResult,
    setImportResult,
    analysis,
    calcA,
    setCalcA,
    whatIfA,
    calcB,
    setCalcB,
    whatIfB,
    importCsvText,
    addManualTrade,
    setMarkPrice,
    refreshLiveQuotes,
    refreshMarks,
    loadPositionIntoCalc,
    saveJournal,
    removeJournal,
    updateSettings,
    updateNote,
    refresh,
    resolvedPairA,
    resolvedPairB,
    resolveCalcPair,
    pairBusyA,
    pairBusyB,
    toggleHiddenSymbol,
    hiddenSet,
    applyMarksUpdate,
  }), [
    ready, error, authError, trades, marks, markDetails, lastRefreshAt, lastCheckedAt, lastRefreshError,
    settings, journal, view, setView, importResult, setImportResult, analysis,
    calcA, setCalcA, whatIfA, calcB, setCalcB, whatIfB,
    importCsvText, addManualTrade, setMarkPrice, refreshLiveQuotes, refreshMarks, loadPositionIntoCalc,
    saveJournal, removeJournal, updateSettings, updateNote, refresh,
    resolvedPairA, resolvedPairB, resolveCalcPair, pairBusyA, pairBusyB,
    toggleHiddenSymbol, hiddenSet, applyMarksUpdate,
  ]);
}

export type Store = ReturnType<typeof useStore>;
