import type { MarkInfo } from '../types';

/** A price we will display: finite and strictly positive. */
export function isUsablePrice(p: unknown): p is number {
  return typeof p === 'number' && Number.isFinite(p) && p > 0;
}

function ts(s: string | null | undefined): number {
  if (!s) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Merge incoming marks (full snapshot, SSE delta or REST response) into the known map.
 *
 * Rules (a known price never goes blank):
 * - Symbols missing from `incoming` keep their previous entry (partial/empty payloads are no-ops).
 * - Entries with an unusable price (null, 0, NaN) are ignored.
 * - An incoming entry older than what we already have is ignored (late/stale snapshot).
 *
 * Returns `prev` itself when nothing changed so React can skip re-renders.
 */
export function mergeMarkDetails(
  prev: Record<string, MarkInfo>,
  incoming: Record<string, MarkInfo> | null | undefined,
): Record<string, MarkInfo> {
  if (!incoming) return prev;
  let next: Record<string, MarkInfo> | null = null;
  for (const [sym, info] of Object.entries(incoming)) {
    if (!info || !isUsablePrice(info.price)) continue;
    const cur = prev[sym];
    if (cur) {
      if (ts(info.updatedAt) < ts(cur.updatedAt)) continue;
      if (
        cur.price === info.price &&
        cur.updatedAt === info.updatedAt &&
        cur.dayPct === info.dayPct &&
        cur.session === info.session &&
        cur.source === info.source
      ) {
        continue;
      }
    }
    if (!next) next = { ...prev };
    next[sym] = info;
  }
  return next ?? prev;
}

/** Flatten details into symbol -> price (only usable prices). */
export function flattenMarks(details: Record<string, MarkInfo>): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [sym, info] of Object.entries(details)) {
    if (isUsablePrice(info.price)) flat[sym] = info.price;
  }
  return flat;
}

export interface WatchlistRowLike {
  symbol: string;
  last: number | null;
  pctChange: number | null;
  valChange: number | null;
  bid: number | null;
  ask: number | null;
  marketCap: number | null;
  volume: number | null;
  week52High: number | null;
  week52Low: number | null;
  updatedAt: string | null;
}

/**
 * Merge a fresh watchlist payload into the rows already on screen.
 * The symbol list/order always comes from `next` (adds/removes work), but a row whose price
 * came back null keeps the last known price/metadata for that symbol.
 */
export function mergeWatchlistRows<T extends WatchlistRowLike>(prev: T[], next: T[] | null | undefined): T[] {
  if (!next) return prev;
  const bySym = new Map(prev.map((r) => [r.symbol.toUpperCase(), r]));
  return next.map((row) => {
    const old = bySym.get(row.symbol.toUpperCase());
    if (!old) return row;
    if (!isUsablePrice(row.last) && isUsablePrice(old.last)) {
      return { ...old, ...pickNonNull(row), last: old.last, updatedAt: old.updatedAt };
    }
    return row;
  });
}

function pickNonNull<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Marks rows are only rewritten when the price changes (D1 write budget), so updated_at means
 * "last change". Only label prices older than this as stale to avoid noise on quiet symbols.
 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** Human age of a price, e.g. "29d", "3h", "12m"; null when fresh (< thresholdMs). */
export function staleAge(updatedAt: string | null | undefined, nowMs: number, thresholdMs = 60 * 60 * 1000): string | null {
  const t = ts(updatedAt);
  if (!Number.isFinite(t)) return null;
  const age = nowMs - t;
  if (age < thresholdMs) return null;
  const min = Math.floor(age / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
