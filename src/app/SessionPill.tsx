import { useEffect, useState } from 'react';
import { nonTradingTooltip, nonTradingWindowAt } from '../lib/marketHours';
import { formatCountdown, sessionStatusAt } from '../lib/sessionClock';

/** US market-session pill with a countdown to the next session change (ticks every 30s, no network). */
export function SessionPill() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const s = sessionStatusAt(now);
  const window_ = nonTradingWindowAt(now);
  const countdown = formatCountdown(s.msUntilNext);
  const at = s.nextAt.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const title = `${s.nextLabel} in ${countdown} (${at})${window_ ? ` · ${nonTradingTooltip(window_)}` : ''}`;

  return (
    <span className={`session-pill session-${s.kind}`} title={title} aria-label={`Market ${s.label}. ${title}`}>
      <span className="session-dot" aria-hidden="true" />
      <span className="session-label">{s.label}</span>
      <span className="session-next num">
        {s.nextLabel} {countdown}
      </span>
    </span>
  );
}
