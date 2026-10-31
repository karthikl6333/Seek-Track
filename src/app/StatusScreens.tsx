import { bootErrorMessage } from '../lib/bootError';

export interface BootScreenProps {
  authError: boolean;
  /** Non-auth failure from the initial load; shown with a Retry button instead of hanging on "Loading data…". */
  error: string | null;
  onRetry: () => void;
}

/** Full-screen state shown until the store is ready: expired session, failed load, or initial load. */
export function BootScreen({ authError, error, onRetry }: BootScreenProps) {
  if (authError) {
    return (
      <div className="main boot-center">
        <p className="muted">Session expired. Please log in again.</p>
        <button type="button" className="btn boot-btn" onClick={() => window.location.reload()}>
          Log In
        </button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="main boot-center" role="alert">
        <div className="boot-error-card">
          <h2>Couldn’t load your data</h2>
          <p className="muted">{bootErrorMessage(error)}</p>
          <button type="button" className="btn boot-btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="main" aria-busy="true">
      <p className="muted">Loading data…</p>
      <div className="skeleton-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton skeleton-card" />
        ))}
      </div>
      <div className="skeleton skeleton-table" aria-hidden="true" />
    </div>
  );
}
