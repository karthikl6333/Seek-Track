import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOT_TIMEOUT_MS, BootTimeoutError, withBootTimeout } from './bootTimeout';
import { bootErrorMessage } from './bootError';

describe('withBootTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with the result when the load finishes in time', async () => {
    await expect(withBootTimeout(async () => 42)).resolves.toBe(42);
  });

  it('rejects with BootTimeoutError and aborts the signal when a fetch never settles', async () => {
    let seen: AbortSignal | undefined;
    const p = withBootTimeout((signal) => {
      seen = signal;
      return new Promise<never>(() => {}); // pending forever, like a missing Basic-auth prompt
    });
    const assertion = expect(p).rejects.toBeInstanceOf(BootTimeoutError);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(BOOT_TIMEOUT_MS);
    await assertion;
    expect(seen?.aborted).toBe(true);
  });

  it('defaults to a 15s deadline', async () => {
    const p = withBootTimeout(() => new Promise<never>(() => {}));
    const assertion = expect(p).rejects.toBeInstanceOf(BootTimeoutError);
    await vi.advanceTimersByTimeAsync(14_999);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('propagates the original error when the load fails first', async () => {
    await expect(withBootTimeout(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('timeout message carries a sign-in/reload hint through bootErrorMessage', () => {
    const msg = bootErrorMessage(String(new BootTimeoutError(15_000)));
    expect(msg).toMatch(/^Timed out after 15s/);
    expect(msg).toMatch(/sign in|reload/i);
  });
});
