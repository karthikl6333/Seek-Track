import { describe, expect, it } from 'vitest';
import { isTypingTarget, resolveShortcut } from './shortcuts';

const body = { tagName: 'BODY' };

describe('resolveShortcut', () => {
  it('maps r/R to refresh', () => {
    expect(resolveShortcut({ key: 'r' }, body)).toEqual({ type: 'refresh' });
    expect(resolveShortcut({ key: 'R' }, body)).toEqual({ type: 'refresh' });
  });

  it('maps 1-9 to 0-based tab indexes and ignores 0', () => {
    expect(resolveShortcut({ key: '1' }, body)).toEqual({ type: 'view', index: 0 });
    expect(resolveShortcut({ key: '9' }, body)).toEqual({ type: 'view', index: 8 });
    expect(resolveShortcut({ key: '0' }, body)).toBeNull();
  });

  it('maps / and ? to search focus and help', () => {
    expect(resolveShortcut({ key: '/' }, body)).toEqual({ type: 'focusSearch' });
    expect(resolveShortcut({ key: '?' }, body)).toEqual({ type: 'help' });
  });

  it('does not fire while typing in a field', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(resolveShortcut({ key: 'r' }, { tagName })).toBeNull();
      expect(resolveShortcut({ key: '1' }, { tagName })).toBeNull();
    }
    expect(resolveShortcut({ key: 'r' }, { tagName: 'DIV', isContentEditable: true })).toBeNull();
    expect(isTypingTarget(null)).toBe(false);
  });

  it('does not hijack modifier combos (Ctrl+R reload, Cmd+1 tab switch)', () => {
    expect(resolveShortcut({ key: 'r', ctrlKey: true }, body)).toBeNull();
    expect(resolveShortcut({ key: 'r', metaKey: true }, body)).toBeNull();
    expect(resolveShortcut({ key: '1', altKey: true }, body)).toBeNull();
  });

  it('Escape always resolves, even from an input', () => {
    expect(resolveShortcut({ key: 'Escape' }, { tagName: 'INPUT' })).toEqual({ type: 'escape' });
  });

  it('ignores other keys', () => {
    expect(resolveShortcut({ key: 'x' }, body)).toBeNull();
  });
});
