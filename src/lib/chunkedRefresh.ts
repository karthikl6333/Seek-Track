/**
 * Refresh `symbols` in fixed-size chunks (each HTTP request gets a fresh 50-subrequest budget on
 * Cloudflare Workers). A failing chunk is logged and skipped; the remaining chunks still run.
 * Resolves true when at least one chunk reported success.
 */
export async function refreshInChunks<R>(
  symbols: string[],
  chunkSize: number,
  label: string,
  refreshChunk: (chunk: string[]) => Promise<R>,
  succeeded: (result: R) => boolean,
): Promise<boolean> {
  let anyChunkOk = false;
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    try {
      const res = await refreshChunk(chunk);
      if (succeeded(res)) anyChunkOk = true;
      console.log(
        `[App] ${label} chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(symbols.length / chunkSize)} complete`,
      );
    } catch (chunkError) {
      console.error(`[App] ${label} chunk ${Math.floor(i / chunkSize) + 1} failed:`, chunkError);
      // Continue to next chunk
    }
  }
  return anyChunkOk;
}
