import { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../lib/db';
import { calcWhatIf, computePositions, type LotEngineResult } from '../lib/lots';
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

  const refreshMarks = useCallback(async () => {
    const detailed = await db.loadMarksDetailed();
    const flat: Record<string, number> = {};
    for (const [sym, info] of Object.entries(detailed.marks)) {
      flat[sym] = info.price;
    }
    setMarks(flat);
    setMarkDetails(detailed.marks);
    setLastRefreshAt(detailed.lastRefreshAt);
    setLastRefreshError(detailed.lastRefreshError);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [t, s, j, pairCache] = await Promise.all([
        db.loadAllTrades(),
        db.loadSettings(),
        db.loadJournal(),
        db.listPairCache().catch(() => ({ pairs: [] as import('../types').PairDef[] })),
      ]);
      setTrades(t);
      // Merge pair_cache into settings.pairs so CrossCheck is not limited to seeds
      const byEtf = new Map(s.pairs.map((p) => [p.etf.toUpperCase(), p]));
      for (const p of pairCache.pairs ?? []) {
        if (!byEtf.has(p.etf.toUpperCase())) byEtf.set(p.etf.toUpperCase(), p);
      }
      setSettings({ ...s, pairs: Array.from(byEtf.values()) });
      setJournal(j);
      await refreshMarks();
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
      await refresh();
      return finalResult;
    },
    [refresh],
  );

  const addManualTrade = useCallback(
    async (input: ManualTradeInput) => {
      setError(null);
      const result = await db.addManualTrade(input);
      await refresh();
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
    async (extra?: string[]) => {
      setError(null);
      setLastRefreshError(null);
      
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
      
      const open =
        analysis?.positions.filter((p) => p.quantity !== 0).map((p) => p.symbol) ?? [];
      let universe = [...new Set([...symbols, ...open].map((s) => s.toUpperCase()).filter(Boolean))];
      
      try {
        // If no symbols, get universe
        if (universe.length === 0) {
          const { symbols: universeSymbols } = await db.getQuoteUniverse();
          universe = universeSymbols;
        }
        
        // Chunk at client level (never send >10 symbols to server)
        const CHUNK_SIZE = 10;
        const allResults: Awaited<ReturnType<typeof db.refreshQuotes>>[] = [];
        
        for (let i = 0; i < universe.length; i += CHUNK_SIZE) {
          const chunk = universe.slice(i, i + CHUNK_SIZE);
          const result = await db.refreshQuotes(chunk);
          
          // Handle needsChunking response (shouldn't happen with chunk ≤10, but be safe)
          if (result.needsChunking && result.universe) {
            // Server returned universe - use it for remaining chunks
            universe = result.universe;
            continue;
          }
          
          allResults.push(result);
        }
        
        await refreshMarks();
        
        // Return aggregated result
        const aggregated = {
          ok: allResults.some(r => r.ok),
          updated: allResults.flatMap(r => r.updated),
          failed: allResults.flatMap(r => r.failed),
          refreshedAt: allResults[allResults.length - 1]?.refreshedAt ?? new Date().toISOString(),
          total: universe.length,
        };
        
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
      await refresh();
    },
    [refresh],
  );

  const removeJournal = useCallback(
    async (id: string) => {
      await db.deleteJournalEntry(id);
      await refresh();
    },
    [refresh],
  );

  const updateSettings = useCallback(
    async (next: AppSettings) => {
      await db.saveSettings(next);
      await refresh();
    },
    [refresh],
  );

  const updateNote = useCallback(
    async (id: string, note: string) => {
      await db.updateTradeNote(id, note);
      await refresh();
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

  return {
    ready,
    error,
    authError,
    trades,
    marks,
    markDetails,
    lastRefreshAt,
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
  };
}

export type Store = ReturnType<typeof useStore>;
