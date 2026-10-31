/**
 * Topbar market-session pill: current US session plus a countdown to the next state change.
 * Built on the shared market-hours module so it always agrees with the refresh scheduler.
 */
import {
  addDays,
  marketSessionAt,
  nonTradingWindowAt,
  nyClock,
  nyWallTimeToDate,
} from './marketHours';

export type SessionKind = 'premarket' | 'regular' | 'afterhours' | 'closed' | 'weekend' | 'holiday';

export interface SessionStatus {
  kind: SessionKind;
  /** Pill label, e.g. "Open", "Pre-market", "Weekend". */
  label: string;
  /** What happens at `nextAt`, e.g. "Closes", "Opens", "Pre-market". */
  nextLabel: string;
  nextAt: Date;
  msUntilNext: number;
}

const LABEL: Record<SessionKind, string> = {
  premarket: 'Pre-market',
  regular: 'Open',
  afterhours: 'After-hours',
  closed: 'Closed',
  weekend: 'Weekend',
  holiday: 'Holiday',
};

export function sessionStatusAt(now: Date): SessionStatus {
  const session = marketSessionAt(now);
  const { date: today, minutes } = nyClock(now);
  let kind: SessionKind;
  let nextLabel: string;
  let nextAt: Date;
  switch (session) {
    case 'regular':
      kind = 'regular';
      nextLabel = 'Closes';
      nextAt = nyWallTimeToDate(today, 16, 0);
      break;
    case 'premarket':
      kind = 'premarket';
      nextLabel = 'Opens';
      nextAt = nyWallTimeToDate(today, 9, 30);
      break;
    case 'afterhours':
      kind = 'afterhours';
      nextLabel = 'Session ends';
      nextAt = nyWallTimeToDate(today, 20, 0);
      break;
    case 'closed':
      kind = 'closed';
      nextLabel = 'Pre-market';
      nextAt = nyWallTimeToDate(minutes < 4 * 60 ? today : addDays(today, 1), 4, 0);
      break;
    default: {
      const w = nonTradingWindowAt(now);
      kind = w?.kind === 'holiday' ? 'holiday' : 'weekend';
      nextLabel = 'Pre-market';
      nextAt = w ? w.resumesAt : now;
    }
  }
  return {
    kind,
    label: LABEL[kind],
    nextLabel,
    nextAt,
    msUntilNext: Math.max(0, nextAt.getTime() - now.getTime()),
  };
}

/** "<1m", "42m", "3h 12m", "1d 14h". */
export function formatCountdown(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMin < 1) return '<1m';
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
