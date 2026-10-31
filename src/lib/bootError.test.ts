import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bootErrorMessage } from './bootError';
import { flashDirection } from './priceFlash';
import { BootScreen } from '../app/StatusScreens';

describe('bootErrorMessage', () => {
  it('strips the Error prefix and keeps the first line', () => {
    expect(bootErrorMessage('Error: 500 Internal Server Error: boom\n  at x')).toBe('500 Internal Server Error: boom');
  });
  it('unwraps a JSON error body', () => {
    expect(bootErrorMessage('Error: 500 Internal Server Error: {"error":"D1 down"}')).toBe('500 Internal Server Error: D1 down');
    expect(bootErrorMessage('Error: 500 x: {not json}')).toBe('500 x: {not json}');
  });
  it('falls back for empty input and truncates long messages', () => {
    expect(bootErrorMessage('')).toMatch(/went wrong/);
    expect(bootErrorMessage(null)).toMatch(/went wrong/);
    expect(bootErrorMessage('x'.repeat(500)).length).toBe(238);
  });
});

describe('BootScreen', () => {
  const noop = () => {};
  it('shows a loading skeleton while booting', () => {
    const html = renderToStaticMarkup(createElement(BootScreen, { authError: false, error: null, onRetry: noop }));
    expect(html).toContain('Loading data');
    expect(html).not.toContain('Retry');
  });
  it('shows the error and a Retry button when boot fails', () => {
    const html = renderToStaticMarkup(
      createElement(BootScreen, { authError: false, error: 'Error: 502 Bad Gateway', onRetry: noop }),
    );
    expect(html).toContain('502 Bad Gateway');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Loading data');
  });
  it('keeps the session-expired screen for auth errors', () => {
    const html = renderToStaticMarkup(createElement(BootScreen, { authError: true, error: 'x', onRetry: noop }));
    expect(html).toContain('Session expired');
    expect(html).toContain('Log In');
  });
});

describe('flashDirection', () => {
  it('flashes on a real change only', () => {
    expect(flashDirection(10, 11)).toBe('up');
    expect(flashDirection(10, 9.99)).toBe('down');
    expect(flashDirection(10, 10)).toBeNull();
  });
  it('never flashes on first value or missing values', () => {
    expect(flashDirection(undefined, 10)).toBeNull();
    expect(flashDirection(null, 10)).toBeNull();
    expect(flashDirection(10, null)).toBeNull();
    expect(flashDirection(10, NaN)).toBeNull();
  });
});
