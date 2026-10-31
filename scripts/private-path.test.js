import { describe, expect, it } from 'vitest';
import { isPrivatePath } from './private-path.js';

describe('isPrivatePath (the worker gate for the private static prefix)', () => {
  it.each([
    '/_private',
    '/_private/',
    '/_private/ideas/abc.webp',
    '/_PRIVATE/ideas/abc.webp',
    '//_private/ideas/abc.webp',
    '/_private//ideas/abc.webp',
    '/%5Fprivate/ideas/abc.webp',
    '/%5fPrivate/ideas/abc.webp',
    '/_private%2Fideas%2Fabc.webp',
    '/%255Fprivate/ideas/abc.webp', // double-encoded
    '/%25255Fprivate/ideas/abc.webp', // triple-encoded
    '/\\_private\\ideas\\abc.webp',
    '/%5C_private/ideas/abc.webp',
    '/_private/%',
    '/%E0%A4%A', // malformed percent-encoding: treated as private (fails closed)
  ])('gates %s', (p) => {
    expect(isPrivatePath(p)).toBe(true);
  });

  it.each(['/', '/index.html', '/assets/app.js', '/api/ideas', '/private/x', '/_privately', '/x/_private/y', '/ideas', '/_priv'])(
    'does not gate %s',
    (p) => {
      expect(isPrivatePath(p)).toBe(false);
    },
  );

  it('survives being embedded with .toString() (self-contained)', () => {
    const rebuilt = new Function(`${isPrivatePath.toString()}; return isPrivatePath;`)();
    expect(rebuilt('/%5Fprivate/x')).toBe(true);
    expect(rebuilt('/ok')).toBe(false);
  });

  it('is what URL parsing leaves us: dot segments and encoded dots cannot sneak around the prefix', () => {
    for (const raw of ['https://x.test/a/../_private/x', 'https://x.test/a/%2e%2e/_private/x', 'https://x.test/./_private/x']) {
      expect(isPrivatePath(new URL(raw).pathname), raw).toBe(true);
    }
  });
});
