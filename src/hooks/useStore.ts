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

const POLL_MS = 15 * 60 * 1000;

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
  const [calc, setCalc] = useState<CalculatorState>(defaultCalc);
  const [error, setError] = useState<string | null>(null);
  const [resolvedPair, setResolvedPair] = useState<PairResolveResult | null>(null);
  const [pairBusy, setPairBusy] = useState(false);

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
  }, [refreshMarks]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  // Client poll every 15 minutes (server also refreshes on cron)
  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        try {
          const pollSyms: string[] = [];
          if (calc.symbol) pollSyms.push(calc.symbol);
          if (resolvedPair?.pair) {
            pollSyms.push(resolvedPair.pair.etf, resolvedPair.pair.underlying);
          }
          await db.refreshQuotes(pollSyms.length ? pollSyms : undefined);
          await refreshMarks();
        } catch (e) {
          console.warn('quote poll failed', e);
        }
      })();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [calc.symbol, refreshMarks, resolvedPair]);

  const analysis: LotEngineResult | null = useMemo(() => {
    if (!settings) return null;
    return computePositions(trades, settings.themes, marks);
  }, [trades, settings, marks]);

  const whatIf = useMemo(() => calcWhatIf(calc), [calc]);

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
      const symbols = [...(extra ?? [])];
      if (calc.symbol) symbols.push(calc.symbol);
      // When a pair is known, always refresh BOTH etf and underlying (e.g. SNDQ + SNDK)
      const pair = resolvedPair?.pair;
      if (pair) {
        symbols.push(pair.etf, pair.underlying);
      } else if (settings) {
        const sym = calc.symbol.trim().toUpperCase();
        const found = settings.pairs.find(
          (p) => p.etf.toUpperCase() === sym || p.underlying.toUpperCase() === sym,
        );
        if (found) symbols.push(found.etf, found.underlying);
      }
      const open =
        analysis?.positions.filter((p) => p.quantity !== 0).map((p) => p.symbol) ?? [];
      const unique = [...new Set([...symbols, ...open].map((s) => s.toUpperCase()).filter(Boolean))];
      const result = await db.refreshQuotes(unique);
      await refreshMarks();
      return result;
    },
    [analysis, calc.symbol, refreshMarks, resolvedPair, settings],
  );

  const loadPositionIntoCalc = useCallback(
    (symbol: string) => {
      const pos = analysis?.positions.find((p) => p.symbol === symbol);
      if (!pos) return;
      setCalc({
        symbol: pos.symbol,
        quantity: pos.quantity,
        entryPrice: Number(pos.avgCost.toFixed(4)),
        fees: 0,
        targetPrice: pos.markPrice ?? Number(pos.avgCost.toFixed(4)),
      });
    },
    [analysis],
  );

  const resolveCalcPair = useCallback(async (symbol?: string) => {
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
  }, [calc.symbol, settings, refreshMarks]);

  // Auto-resolve when calculator symbol changes
  useEffect(() => {
    const sym = calc.symbol.trim().toUpperCase();
    if (!sym) {
      setResolvedPair(null);
      return;
    }
    const t = setTimeout(() => {
      void resolveCalcPair(sym);
    }, 400);
    return () => clearTimeout(t);
  }, [calc.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

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
      await updateSettings({
        ...settings,
        hiddenSymbols: Array.from(current).sort(),
      });
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
    calc,
    setCalc,
    whatIf,
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
    resolvedPair,
    resolveCalcPair,
    pairBusy,
    toggleHiddenSymbol,
    hiddenSet,
  };
}

export type Store = ReturnType<typeof useStore>;
