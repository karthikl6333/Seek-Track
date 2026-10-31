-- Cloudflare D1 (SQLite) Schema for Seek&Track
-- Migrated from Neon Postgres schema.sql

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  row_hash TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  fees REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'csv'
);

CREATE INDEX IF NOT EXISTS trades_symbol_idx ON trades (symbol);
CREATE INDEX IF NOT EXISTS trades_date_idx ON trades (date);
CREATE INDEX IF NOT EXISTS trades_source_idx ON trades (source);

CREATE TABLE IF NOT EXISTS marks (
  symbol TEXT PRIMARY KEY,
  price REAL NOT NULL,
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  day_pct REAL,
  session TEXT
);

CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS journal_date_idx ON journal (date);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '{}'
);

INSERT OR IGNORE INTO settings (id, data) VALUES (1, '{}');

CREATE TABLE IF NOT EXISTS pair_cache (
  etf TEXT PRIMARY KEY,
  underlying TEXT NOT NULL,
  factor REAL NOT NULL,
  theme TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'seed',
  raw_name TEXT,
  resolved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS research_universe (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  sector_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS research_etf_map (
  underlying TEXT NOT NULL,
  etf TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('bull', 'bear')),
  factor REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (underlying, etf)
);

CREATE INDEX IF NOT EXISTS research_etf_map_underlying_idx ON research_etf_map (underlying);

CREATE TABLE IF NOT EXISTS research_universe_excluded (
  symbol TEXT PRIMARY KEY,
  removed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS watchlist_sort_idx ON watchlist (sort_order ASC, symbol ASC);

CREATE TABLE IF NOT EXISTS watchlist_quotes (
  symbol TEXT PRIMARY KEY,
  last REAL,
  pct_change REAL,
  val_change REAL,
  bid REAL,
  ask REAL,
  market_cap REAL,
  volume REAL,
  week52_high REAL,
  week52_low REAL,
  session_open REAL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS paper_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  equity REAL NOT NULL DEFAULT 0,
  cash REAL NOT NULL DEFAULT 0,
  buying_power REAL NOT NULL DEFAULT 0,
  day_pnl REAL NOT NULL DEFAULT 0,
  week_pnl REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  mandate_start TEXT NOT NULL DEFAULT CURRENT_DATE,
  mandate_end TEXT NOT NULL DEFAULT CURRENT_DATE,
  strategy_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  t0_equity REAL NOT NULL DEFAULT 100000
);

INSERT OR IGNORE INTO paper_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note, t0_equity, updated_at)
VALUES (1, 0, 0, 0, 0, 0, 'idle', '2026-09-08', '2026-09-12', 'Levered semis / mega-cap swing', 100000, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE IF NOT EXISTS paper_positions (
  symbol TEXT PRIMARY KEY,
  quantity REAL NOT NULL,
  avg_price REAL NOT NULL,
  market_value REAL,
  unrealized_pnl REAL,
  theme TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  filled_qty REAL NOT NULL DEFAULT 0,
  avg_fill_price REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  filled_at TEXT
);

CREATE INDEX IF NOT EXISTS paper_orders_created_idx ON paper_orders (created_at DESC);

CREATE TABLE IF NOT EXISTS paper_journal (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS paper_journal_created_idx ON paper_journal (created_at DESC);

CREATE TABLE IF NOT EXISTS crypto_paper_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  equity REAL NOT NULL DEFAULT 0,
  cash REAL NOT NULL DEFAULT 0,
  buying_power REAL NOT NULL DEFAULT 0,
  day_pnl REAL NOT NULL DEFAULT 0,
  week_pnl REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  mandate_start TEXT NOT NULL DEFAULT CURRENT_DATE,
  mandate_end TEXT NOT NULL DEFAULT CURRENT_DATE,
  strategy_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  t0_equity REAL NOT NULL DEFAULT 149953
);

INSERT OR IGNORE INTO crypto_paper_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note, t0_equity, updated_at)
VALUES (1, 0, 0, 0, 0, 0, 'idle', '2026-09-08', '2026-09-12', 'Crypto-only paper trading', 149953, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE IF NOT EXISTS crypto_paper_positions (
  symbol TEXT PRIMARY KEY,
  quantity REAL NOT NULL,
  avg_price REAL NOT NULL,
  market_value REAL,
  unrealized_pnl REAL,
  theme TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS crypto_paper_orders (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  filled_qty REAL NOT NULL DEFAULT 0,
  avg_fill_price REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  filled_at TEXT
);

CREATE INDEX IF NOT EXISTS crypto_paper_orders_created_idx ON crypto_paper_orders (created_at DESC);

CREATE TABLE IF NOT EXISTS crypto_paper_journal (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS crypto_paper_journal_created_idx ON crypto_paper_journal (created_at DESC);

CREATE TABLE IF NOT EXISTS paper_flex_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  equity REAL NOT NULL DEFAULT 0,
  cash REAL NOT NULL DEFAULT 0,
  buying_power REAL NOT NULL DEFAULT 0,
  day_pnl REAL NOT NULL DEFAULT 0,
  week_pnl REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  mandate_start TEXT NOT NULL DEFAULT CURRENT_DATE,
  mandate_end TEXT NOT NULL DEFAULT CURRENT_DATE,
  strategy_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  t0_equity REAL NOT NULL DEFAULT 200000
);

INSERT OR IGNORE INTO paper_flex_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note, t0_equity, updated_at)
VALUES (1, 0, 0, 0, 0, 0, 'idle', '2026-09-08', '2026-09-12', 'FLEX-STK / A1 ORB-DAY-ETF', 200000, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE IF NOT EXISTS paper_flex_positions (
  symbol TEXT PRIMARY KEY,
  quantity REAL NOT NULL,
  avg_price REAL NOT NULL,
  market_value REAL,
  unrealized_pnl REAL,
  theme TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS paper_flex_orders (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  filled_qty REAL NOT NULL DEFAULT 0,
  avg_fill_price REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  filled_at TEXT
);

CREATE INDEX IF NOT EXISTS paper_flex_orders_created_idx ON paper_flex_orders (created_at DESC);

CREATE TABLE IF NOT EXISTS paper_flex_journal (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS paper_flex_journal_created_idx ON paper_flex_journal (created_at DESC);

CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  target_price REAL NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  triggered_at TEXT,
  last_price REAL,
  notified_at TEXT
);

CREATE INDEX IF NOT EXISTS price_alerts_symbol_idx ON price_alerts (symbol);
CREATE INDEX IF NOT EXISTS price_alerts_status_idx ON price_alerts (status);
CREATE INDEX IF NOT EXISTS price_alerts_created_idx ON price_alerts (created_at DESC);

-- v2 (D1 read budget): turn hot scans into index seeks.
-- SSE / ?since= delta reads: WHERE updated_at > ? reads only changed rows.
CREATE INDEX IF NOT EXISTS marks_updated_at_idx ON marks (updated_at);
-- Alert evaluation: WHERE status = 'active' AND symbol IN (...)
CREATE INDEX IF NOT EXISTS price_alerts_status_symbol_idx ON price_alerts (status, symbol);
-- Pair resolution by underlying: WHERE underlying = ?
CREATE INDEX IF NOT EXISTS pair_cache_underlying_idx ON pair_cache (underlying);
