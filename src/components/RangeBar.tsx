import { rangePosition } from '../lib/watchlist';

/** Tiny 52-week range bar: low ─●─ high. Renders an empty track when the range is unknown. */
export function RangeBar({
  last,
  low,
  high,
}: {
  last: number | null | undefined;
  low: number | null | undefined;
  high: number | null | undefined;
}) {
  const pos = rangePosition(last, low, high);
  const label =
    pos === null
      ? '52-week range unavailable'
      : `${Math.round(pos * 100)}% of 52-week range (${low!.toFixed(2)} – ${high!.toFixed(2)})`;
  return (
    <span className="range-bar" role="img" aria-label={label} title={label}>
      {pos !== null && <span className="range-bar-dot" style={{ left: `${(pos * 100).toFixed(1)}%` }} />}
    </span>
  );
}
