export interface FilterChipOption<K extends string> {
  key: K;
  label: string;
  count: number;
}

/** "All" + one toggle button per option; an empty `active` set means "All". */
export function FilterChips<K extends string>({
  options,
  active,
  totalCount,
  onToggle,
  onClear,
  ariaLabel,
}: {
  options: FilterChipOption<K>[];
  active: ReadonlySet<K>;
  totalCount: number;
  onToggle: (key: K) => void;
  onClear: () => void;
  ariaLabel: string;
}) {
  return (
    <div className="chip-row" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className={`btn small${active.size === 0 ? ' primary' : ''}`}
        aria-pressed={active.size === 0}
        onClick={onClear}
      >
        All ({totalCount})
      </button>
      {options.map(({ key, label, count }) => (
        <button
          key={key}
          type="button"
          className={`btn small${active.has(key) ? ' primary' : ''}`}
          aria-pressed={active.has(key)}
          onClick={() => onToggle(key)}
        >
          {label} ({count})
        </button>
      ))}
    </div>
  );
}
