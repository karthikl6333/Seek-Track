/** How long the initial data load may take before we stop waiting and offer Retry. */
export const BOOT_TIMEOUT_MS = 15_000;

export class BootTimeoutError extends Error {
  constructor(ms: number) {
    super(
      `Timed out after ${Math.round(ms / 1000)}s waiting for the server. ` +
        `If a sign-in prompt never appeared, reload the page or sign in again, then press Retry.`,
    );
    this.name = 'BootTimeoutError';
  }
}

/**
 * Run `run` with an AbortSignal that fires after `ms`. Rejects with BootTimeoutError at the deadline
 * even if `run` ignores the signal (some loaders swallow errors), and aborts in-flight requests.
 */
export function withBootTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number = BOOT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new BootTimeoutError(ms));
    }, ms);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}
