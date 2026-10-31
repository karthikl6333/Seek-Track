import { useEffect, useRef, type ReactNode } from 'react';

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Trigger button content. */
  trigger: ReactNode;
  ariaLabel: string;
  title?: string;
  children: ReactNode;
}

/** Small anchored popover: closes on outside click or Escape. */
export function Popover({ open, onOpenChange, trigger, ariaLabel, title, children }: PopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div className="popover-root" ref={rootRef}>
      <button
        type="button"
        className="btn topbar-btn topbar-icon-btn"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title ?? ariaLabel}
        onClick={() => onOpenChange(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div className="popover-panel" role="dialog" aria-label={ariaLabel}>
          {children}
        </div>
      )}
    </div>
  );
}
