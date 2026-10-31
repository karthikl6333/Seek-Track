/** Full-screen state shown until the store is ready: expired session or initial load. */
export function BootScreen({ authError }: { authError: boolean }) {
  if (authError) {
    return (
      <div className="main" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <p className="muted">Session expired. Please log in again.</p>
        <button
          type="button"
          className="btn"
          onClick={() => window.location.reload()}
          style={{
            minWidth: 120,
            minHeight: 40,
            height: 40,
            paddingLeft: 16,
            paddingRight: 16,
            fontSize: 14,
          }}
        >
          Log In
        </button>
      </div>
    );
  }
  return (
    <div className="main">
      <p className="muted">Loading data…</p>
    </div>
  );
}
