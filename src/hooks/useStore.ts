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

export function useStore() {
  const [ready, setReady] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [marks, setMarks] = useState<Record<string, number>>({});
  const [markDetails, setMarkDetails] = useState<Record<string, MarkInfo>>({});
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [lastRefreshError, setLastRefreshError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [view, setView] = useState<ViewId>('overview');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [calc, setCalc] = useState<CalculatorState>(defaultCalc);
  const [error, setError] = useState<string | null>(null);
  const [resolvedPair, setResolvedPair] = useState<PairResolveResult | null>(null);
  const [pairBusy, setPairBusy] = useState(false);

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
          await db.refreshQuotes(calc.symbol ? [calc.symbol] : undefined);
          await refreshMarks();
        } catch (e) {
          console.warn('quote poll failed', e);
        }
      })();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [calc.symbol, refreshMarks]);

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
      const symbols = extra ?? [];
      if (calc.symbol) symbols.push(calc.symbol);
      const open =
        analysis?.positions.filter((p) => p.quantity !== 0).map((p) => p.symbol) ?? [];
      const result = await db.refreshQuotes([...symbols, ...open]);
      await refreshMarks();
      return result;
    },
    [analysis, calc.symbol, refreshMarks],
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
          };
          setSettings(next);
        }
      }
      return result;
    } catch (e) {
      setResolvedPair({ pair: null, as: 'unknown', message: String(e) });
      return null;
    } finally {
      setPairBusy(false);
    }
  }, [calc.symbol, settings]);

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
  };
}

export type Store = ReturnType<typeof useStore>;
