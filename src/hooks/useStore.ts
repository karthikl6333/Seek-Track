import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseSchwabCsv } from '../lib/csv';
import * as db from '../lib/db';
import { calcWhatIf, computePositions, type LotEngineResult } from '../lib/lots';
import type { AppSettings, CalculatorState, ImportResult, JournalEntry, Trade, ViewId } from '../types';

const defaultCalc: CalculatorState = {
  symbol: '',
  quantity: 100,
  entryPrice: 0,
  fees: 0,
  targetPrice: 0,
};

export function useStore() {
  const [ready, setReady] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [marks, setMarks] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [view, setView] = useState<ViewId>('overview');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [calc, setCalc] = useState<CalculatorState>(defaultCalc);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [t, m, s, j] = await Promise.all([
      db.loadAllTrades(),
      db.loadMarks(),
      db.loadSettings(),
      db.loadJournal(),
    ]);
    setTrades(t);
    setMarks(m);
    setSettings(s);
    setJournal(j);
    setReady(true);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  const analysis: LotEngineResult | null = useMemo(() => {
    if (!settings) return null;
    return computePositions(trades, settings.themes, marks);
  }, [trades, settings, marks]);

  const whatIf = useMemo(() => calcWhatIf(calc), [calc]);

  const importCsvText = useCallback(
    async (text: string) => {
      setError(null);
      const hashes = await db.getExistingHashes();
      const { trades: parsed, result } = await parseSchwabCsv(text, hashes);
      const added = await db.appendTrades(parsed);
      const finalResult = { ...result, added };
      setImportResult(finalResult);
      await refresh();
      return finalResult;
    },
    [refresh],
  );

  const setMarkPrice = useCallback(
    async (symbol: string, price: number) => {
      await db.setMark(symbol, price);
      await refresh();
    },
    [refresh],
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
    setMarkPrice,
    loadPositionIntoCalc,
    saveJournal,
    removeJournal,
    updateSettings,
    updateNote,
    refresh,
  };
}

export type Store = ReturnType<typeof useStore>;
