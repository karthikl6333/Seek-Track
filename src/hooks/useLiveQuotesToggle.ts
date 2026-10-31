import { useCallback, useState } from 'react';

const LIVE_QUOTES_KEY = 'seektrack.liveQuotes';

/** Persisted (localStorage) Live On/Off preference. Defaults to ON. */
export function useLiveQuotesToggle() {
  const [liveQuotesEnabled, setLiveQuotesEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(LIVE_QUOTES_KEY);
      return saved === null ? true : saved === 'true'; // Default ON
    } catch {
      return true;
    }
  });

  const toggleLiveQuotes = useCallback(() => {
    setLiveQuotesEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LIVE_QUOTES_KEY, String(next));
      } catch {
        // ignore
      }
      console.log(`[App] Live quotes ${next ? 'enabled' : 'disabled'}`);
      return next;
    });
  }, []);

  return { liveQuotesEnabled, toggleLiveQuotes };
}
