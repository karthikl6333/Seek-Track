import { useCallback, useEffect, useState } from 'react';
import type { NewsSignal, NewsRefreshResult } from '../types';
import { loadNewsSignals, refreshNews } from '../lib/db';

function timeSince(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function directionBadgeClass(direction: string): string {
  switch (direction) {
    case 'bullish':
      return 'badge-bullish';
    case 'bearish':
      return 'badge-bearish';
    default:
      return 'badge-neutral';
  }
}

export function NewsRecommendations() {
  const [signals, setSignals] = useState<NewsSignal[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState<string[]>([]);
  const [degraded, setDegraded] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await loadNewsSignals();
      setSignals(result.signals || []);
      setRefreshedAt(result.refreshedAt);
      setError(null);
    } catch (err) {
      console.error('Failed to load news:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    
    try {
      const result: NewsRefreshResult = await refreshNews();
      
      if (result.status === 'unconfigured') {
        setUnconfigured(result.missing || []);
        setError(`News feed not configured: set ${result.missing?.join(', ')}`);
      } else {
        setUnconfigured([]);
        setSignals(result.signals || []);
        setRefreshedAt(result.refreshedAt);
        setDegraded(result.degraded || []);
        
        if (result.status === 'partial') {
          setError(`Partial data: ${result.degraded?.join(', ')} unavailable`);
        } else if (result.status === 'error') {
          setError(result.error || 'Refresh failed');
        }
      }
    } catch (err) {
      console.error('Failed to refresh news:', err);
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lastUpdatedIST = refreshedAt
    ? new Date(refreshedAt).toLocaleString(undefined, { timeZone: 'Asia/Kolkata' }) + ' IST'
    : null;

  return (
    <div className="news-recommendations-tile">
      <div className="news-header">
        <h3>News Recommendations</h3>
        <div className="news-header-actions">
          {lastUpdatedIST && (
            <span className="muted" style={{ fontSize: 12 }}>
              {lastUpdatedIST}
            </span>
          )}
          <button
            type="button"
            className="btn small"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh news now"
          >
            {refreshing ? '⟳ Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="news-error">
          <span className="badge" style={{ backgroundColor: '#f44336', color: 'white' }}>
            {unconfigured.length > 0 ? 'Not Configured' : 'Error'}
          </span>
          <span style={{ marginLeft: 8 }}>{error}</span>
        </div>
      )}

      {degraded.length > 0 && !error && (
        <div className="news-warning">
          <span className="badge" style={{ backgroundColor: '#ff9800', color: 'white' }}>
            Partial
          </span>
          <span style={{ marginLeft: 8 }}>
            Degraded sources: {degraded.join(', ')}
          </span>
        </div>
      )}

      {loading ? (
        <div className="news-loading">Loading news...</div>
      ) : signals.length === 0 ? (
        <div className="news-empty">
          {unconfigured.length > 0
            ? 'Configure API keys to enable news recommendations'
            : 'No news signals available. Click Refresh to fetch.'}
        </div>
      ) : (
        <div className="news-cards-container">
          <div className="news-cards">
            {signals.map((signal) => (
              <div key={signal.id} className="news-card">
                <div className="news-card-header">
                  {signal.ticker && (
                    <span className="news-ticker">{signal.ticker}</span>
                  )}
                  <span className={`badge ${directionBadgeClass(signal.direction)}`}>
                    {signal.direction}
                  </span>
                  <span
                    className="news-confidence"
                    style={{
                      color: signal.confidence >= 0.7 ? '#4caf50' : signal.confidence >= 0.5 ? '#ff9800' : '#999',
                    }}
                  >
                    {formatConfidence(signal.confidence)}
                  </span>
                </div>

                <div className="news-card-body">
                  <p className="news-rationale">{signal.rationale}</p>
                  {signal.positionImpact && (
                    <p className="news-impact muted">{signal.positionImpact}</p>
                  )}
                </div>

                <div className="news-card-footer">
                  <div className="news-meta">
                    {signal.corroborationStatus === 'corroborated' ? (
                      <span className="badge" style={{ backgroundColor: '#4caf50', color: 'white', fontSize: 10 }}>
                        Confirmed
                      </span>
                    ) : (
                      <span className="badge" style={{ backgroundColor: '#999', color: 'white', fontSize: 10 }}>
                        Unconfirmed
                      </span>
                    )}
                    <span className="muted" style={{ fontSize: 11 }}>
                      {signal.sourceCount} source{signal.sourceCount > 1 ? 's' : ''}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {timeSince(signal.createdAt)}
                    </span>
                  </div>
                  {signal.corroborationLink && (
                    <a
                      href={signal.corroborationLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="news-link"
                      style={{ fontSize: 11 }}
                    >
                      Source →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
