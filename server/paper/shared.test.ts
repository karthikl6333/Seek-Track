import { describe, expect, it } from 'vitest';
import { buildThemeResolver, toCamelCase } from './shared.js';

describe('toCamelCase', () => {
  it('converts snake_case keys, keeps values', () => {
    expect(toCamelCase<{ dayPnl: number; buyingPower: number; id: number }>({ day_pnl: 1, buying_power: 2, id: 3 })).toEqual({
      dayPnl: 1,
      buyingPower: 2,
      id: 3,
    });
  });
});

describe('buildThemeResolver', () => {
  const themes = { themes: [{ name: 'AI', symbols: ['nvda', 'AMD'] }, { name: 'Space', symbols: ['RKLB'] }] };

  it('matches case-insensitively from an object', () => {
    const t = buildThemeResolver(themes);
    expect(t('NVDA')).toBe('AI');
    expect(t('amd')).toBe('AI');
    expect(t('RKLB')).toBe('Space');
    expect(t('XYZ')).toBe('');
  });

  it('parses JSON text (D1 storage)', () => {
    expect(buildThemeResolver(JSON.stringify(themes))('rklb')).toBe('Space');
  });

  it('degrades to no themes on bad / missing settings', () => {
    expect(buildThemeResolver('{not json')('NVDA')).toBe('');
    expect(buildThemeResolver(undefined)('NVDA')).toBe('');
    expect(buildThemeResolver({ themes: 'x' })('NVDA')).toBe('');
    expect(buildThemeResolver({ themes: [{ name: 'NoSymbols' }] })('NVDA')).toBe('');
  });
});
