/** Keyboard shortcut resolution (pure, so it can be unit tested without a DOM). */

export type ShortcutAction =
  | { type: 'refresh' }
  | { type: 'view'; index: number } // 0-based tab index
  | { type: 'focusSearch' }
  | { type: 'help' }
  | { type: 'escape' };

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** True when keystrokes should go to the focused control rather than trigger shortcuts. */
export function isTypingTarget(t: TargetLike | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function resolveShortcut(e: KeyLike, target: TargetLike | null | undefined): ShortcutAction | null {
  if (e.key === 'Escape') return { type: 'escape' };
  if (e.ctrlKey || e.metaKey || e.altKey) return null; // never hijack browser/OS combos
  if (isTypingTarget(target)) return null;
  if (e.key === 'r' || e.key === 'R') return { type: 'refresh' };
  if (e.key === '/') return { type: 'focusSearch' };
  if (e.key === '?') return { type: 'help' };
  if (/^[1-9]$/.test(e.key)) return { type: 'view', index: Number(e.key) - 1 };
  return null;
}

export const SHORTCUT_HELP: { keys: string; what: string }[] = [
  { keys: 'R', what: 'Refresh prices now' },
  { keys: '1 – 9', what: 'Switch tab (Overview … Crypto Paper)' },
  { keys: '/', what: 'Focus the watchlist ticker box' },
  { keys: '?', what: 'Show / hide this help' },
  { keys: 'Esc', what: 'Close popovers' },
];
