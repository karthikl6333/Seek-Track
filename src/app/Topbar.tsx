import { nonTradingTooltip, type NonTradingWindow } from '../lib/marketHours';
import type { SeasonPref, SeasonTheme } from '../lib/seasons';
import { AppearanceMenu } from './AppearanceMenu';
import { SessionPill } from './SessionPill';
import { ShortcutHelp } from './ShortcutHelp';
import type { ViewId } from '../types/index';
import { NAV } from './nav';

export interface TopbarProps {
  view: ViewId;
  liveQuotesEnabled: boolean;
  liveConnected: boolean;
  closedWindow: NonTradingWindow | null;
  lastRefreshError: string | null;
  refreshing: boolean;
  refreshComplete: boolean;
  onToggleLive: () => void;
  onLogout: () => void;
  onManualRefresh: () => void;
  seasonPref: SeasonPref;
  seasonTheme: SeasonTheme | null;
  onSeasonChange: (p: SeasonPref) => void;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
}

/** Page title, Live/Delayed badge and the live / logout / refresh controls. */
export function Topbar({
  view,
  liveQuotesEnabled,
  liveConnected,
  closedWindow,
  lastRefreshError,
  refreshing,
  refreshComplete,
  onToggleLive,
  onLogout,
  onManualRefresh,
  seasonPref,
  seasonTheme,
  onSeasonChange,
  helpOpen,
  onHelpOpenChange,
}: TopbarProps) {
  return (
    <div className="topbar">
      <div className="topbar-title">
        {seasonTheme && (
          <span className="season-ornament" aria-hidden="true" title={`${seasonTheme.label} theme`}>
            {seasonTheme.ornament}
          </span>
        )}
        <h2>{NAV.find((n) => n.id === view)?.label}</h2>
        <SessionPill />
      </div>
      <div className="topbar-actions">
        {/* Live/Delayed badge */}
        <div
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            background: liveQuotesEnabled && !closedWindow
              ? (liveConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)')
              : 'rgba(156, 163, 175, 0.15)',
            color: liveQuotesEnabled && !closedWindow
              ? (liveConnected ? '#22c55e' : '#eab308')
              : '#9ca3af',
            border: `1px solid ${liveQuotesEnabled && !closedWindow
              ? (liveConnected ? '#22c55e' : '#eab308')
              : '#9ca3af'}`,
          }}
          title={closedWindow
            ? nonTradingTooltip(closedWindow)
            : liveQuotesEnabled
            ? (liveConnected ? 'Live streaming active (~5s updates)' : 'Connecting to live stream...')
            : 'Session-aware delayed refresh'}
        >
          {closedWindow ? 'Paused' : liveQuotesEnabled ? (liveConnected ? '● Live' : '○ Connecting') : 'Delayed'}
        </div>
      
        {/* Live quotes toggle */}
        <button
          type="button"
          className="btn"
          onClick={onToggleLive}
          title={liveQuotesEnabled ? 'Disable live quotes (session-aware poll)' : 'Enable live quotes (SSE)'}
          style={{
            minWidth: 70,
            minHeight: 40,
            height: 40,
            paddingLeft: 12,
            paddingRight: 12,
            fontSize: 13,
            background: liveQuotesEnabled ? 'var(--accent, #3d8bfd)' : undefined,
          }}
        >
          {liveQuotesEnabled ? 'Live On' : 'Live Off'}
        </button>
      
        {lastRefreshError && (
          <div
            style={{
              fontSize: 12,
              color: '#e67e22',
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={`${lastRefreshError} (last known prices still shown)`}
          >
            ⚠ {lastRefreshError.split('\n')[0].slice(0, 100)}
          </div>
        )}
        <AppearanceMenu pref={seasonPref} theme={seasonTheme} onChange={onSeasonChange} />
        <ShortcutHelp open={helpOpen} onOpenChange={onHelpOpenChange} />
        <button
          type="button"
          className="btn"
          onClick={() => void onLogout()}
          title="Log out and re-authenticate"
          style={{
            minWidth: 70,
            minHeight: 40,
            height: 40,
            paddingLeft: 12,
            paddingRight: 12,
            fontSize: 13,
          }}
        >
          Logout
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void onManualRefresh()}
          disabled={refreshing}
          title="Refresh all prices now (R) · auto: 30s"
          style={{
            minWidth: 40,
            minHeight: 40,
            width: 40,
            height: 40,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            borderRadius: '50%',
            opacity: refreshing ? 0.6 : 1,
            animation: refreshing ? 'spin 1s linear infinite' : 'none',
            transition: 'all 0.15s ease',
            background: refreshComplete ? 'var(--accent, #3d8bfd)' : undefined,
            boxShadow: refreshComplete ? '0 0 12px color-mix(in srgb, var(--accent) 55%, transparent)' : undefined,
          }}
        >
          {refreshComplete ? '✓' : '↻'}
        </button>
      </div>
    </div>
  );
}
