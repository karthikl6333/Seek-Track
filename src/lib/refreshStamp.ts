/**
 * "Last checked" stamps for the price displays.
 *
 * The server only rewrites marks rows whose price/session changed (D1 write budget), so
 * marks.updated_at means "last price change". When the market is closed a successful refresh
 * usually changes nothing, and a stamp derived from updated_at would freeze, which looks like
 * refresh isn't running. The UI therefore also keeps the CLIENT time of the last successful refresh
 * response (zero extra D1 writes) and shows whichever is newer. Per-row age/stale labels keep
 * using the real price time (MarkInfo.updatedAt).
 */

/** Newest of the given ISO timestamps (invalid/empty values ignored), or null. */
export function latestIso(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = v;
      bestMs = ms;
    }
  }
  return best;
}

/** A refresh outcome counts as a successful check only when a response came back with ok !== false. */
export function refreshSucceeded(outcome: { ok?: boolean } | null | undefined): boolean {
  return !!outcome && outcome.ok !== false;
}

/**
 * Next "last checked" stamp after a refresh attempt: `now` on success (whether or not any price
 * changed), unchanged on failure. Never moves backwards.
 */
export function checkedAtAfter(
  prev: string | null,
  outcome: { ok?: boolean } | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!refreshSucceeded(outcome)) return prev;
  return latestIso(prev, now.toISOString());
}

/** Newest `updatedAt` among the marks we hold (the client's delta cursor), or null. */
export function newestMarkStamp(details: Record<string, { updatedAt?: string | null }>): string | null {
  return latestIso(...Object.values(details).map((m) => m?.updatedAt ?? null));
}
