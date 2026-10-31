import { useEffect, useRef } from 'react';
import { resolveShortcut, type ShortcutAction } from '../lib/shortcuts';

/** Global keyboard shortcuts. The handler is kept in a ref so the listener is attached once. */
export function useKeyboardShortcuts(onAction: (a: ShortcutAction) => void) {
  const ref = useRef(onAction);
  ref.current = onAction;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = resolveShortcut(e, e.target as HTMLElement | null);
      if (!action) return;
      if (action.type !== 'escape') e.preventDefault();
      ref.current(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
