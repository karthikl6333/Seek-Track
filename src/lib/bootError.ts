/** Turn a thrown value's string form (e.g. "Error: 500 Internal Server Error: boom") into a short, readable line. */
export function bootErrorMessage(raw: string | null | undefined): string {
  let first = String(raw ?? '').split('\n')[0].replace(/^(Error|TypeError):\s*/, '').trim();
  // "500 Internal Server Error: {"error":"boom"}" -> "500 Internal Server Error: boom"
  const m = first.match(/^(.*?:\s*)(\{.*\})$/);
  if (m) {
    try {
      const j = JSON.parse(m[2]) as { error?: unknown; message?: unknown };
      const detail = typeof j.error === 'string' ? j.error : typeof j.message === 'string' ? j.message : '';
      if (detail) first = `${m[1]}${detail}`;
    } catch {
      /* keep the raw text */
    }
  }
  if (!first) return 'Something went wrong while loading your data.';
  return first.length > 240 ? `${first.slice(0, 237)}…` : first;
}
