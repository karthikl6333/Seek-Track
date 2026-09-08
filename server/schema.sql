CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  row_hash TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quantity DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  fees DOUBLE PRECISION NOT NULL DEFAULT 0,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL,
  note TEXT
);

CREATE INDEX IF NOT EXISTS trades_symbol_idx ON trades (symbol);
CREATE INDEX IF NOT EXISTS trades_date_idx ON trades (date);

-- source: 'csv' | 'manual' (manual fills can be overridden on re-import)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'csv';
CREATE INDEX IF NOT EXISTS trades_source_idx ON trades (source);

CREATE TABLE IF NOT EXISTS marks (
  symbol TEXT PRIMARY KEY,
  price DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE marks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS journal_date_idx ON journal (date);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO settings (id, data)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Cached leveraged/inverse ETF ↔ underlying resolutions (seeds + discovered)
CREATE TABLE IF NOT EXISTS pair_cache (
  etf TEXT PRIMARY KEY,
  underlying TEXT NOT NULL,
  factor DOUBLE PRECISION NOT NULL,
  theme TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'seed',
  raw_name TEXT,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Research tab: top silicon / semiconductor universe
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
  factor DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (underlying, etf)
);

CREATE INDEX IF NOT EXISTS research_etf_map_underlying_idx ON research_etf_map (underlying);

-- Tickers the user removed from Research; never re-seed these on refresh
CREATE TABLE IF NOT EXISTS research_universe_excluded (
  symbol TEXT PRIMARY KEY,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE marks ADD COLUMN IF NOT EXISTS day_pct DOUBLE PRECISION;

-- User watchlist (Overview). Seed-once from research_universe when empty + flag unset.
CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS watchlist_sort_idx ON watchlist (sort_order ASC, symbol ASC);

-- Dedicated quote cache for watchlist (do not overload marks)
CREATE TABLE IF NOT EXISTS watchlist_quotes (
  symbol TEXT PRIMARY KEY,
  last DOUBLE PRECISION,
  pct_change DOUBLE PRECISION,
  val_change DOUBLE PRECISION,
  bid DOUBLE PRECISION,
  ask DOUBLE PRECISION,
  market_cap DOUBLE PRECISION,
  volume DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE watchlist_quotes ADD COLUMN IF NOT EXISTS week52_high DOUBLE PRECISION;
ALTER TABLE watchlist_quotes ADD COLUMN IF NOT EXISTS week52_low DOUBLE PRECISION;
ALTER TABLE watchlist_quotes ADD COLUMN IF NOT EXISTS session_open DOUBLE PRECISION;

-- Paper trading experiment (Alpaca PAPER account tracking)
CREATE TABLE IF NOT EXISTS paper_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  equity DOUBLE PRECISION NOT NULL DEFAULT 0,
  cash DOUBLE PRECISION NOT NULL DEFAULT 0,
  buying_power DOUBLE PRECISION NOT NULL DEFAULT 0,
  day_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  week_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  mandate_start DATE NOT NULL DEFAULT CURRENT_DATE,
  mandate_end DATE NOT NULL DEFAULT CURRENT_DATE,
  strategy_note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO paper_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note)
VALUES (1, 0, 0, 0, 0, 0, 'idle', '2026-09-08', '2026-09-12', 'Levered semis / mega-cap swing')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS paper_positions (
  symbol TEXT PRIMARY KEY,
  quantity DOUBLE PRECISION NOT NULL,
  avg_price DOUBLE PRECISION NOT NULL,
  market_value DOUBLE PRECISION,
  unrealized_pnl DOUBLE PRECISION,
  theme TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  filled_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_fill_price DOUBLE PRECISION,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  filled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS paper_orders_created_idx ON paper_orders (created_at DESC);

CREATE TABLE IF NOT EXISTS paper_journal (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paper_journal_created_idx ON paper_journal (created_at DESC);

-- Crypto Paper trading experiment (Alpaca PAPER crypto-only account tracking)
CREATE TABLE IF NOT EXISTS crypto_paper_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  equity DOUBLE PRECISION NOT NULL DEFAULT 0,
  cash DOUBLE PRECISION NOT NULL DEFAULT 0,
  buying_power DOUBLE PRECISION NOT NULL DEFAULT 0,
  day_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  week_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  mandate_start DATE NOT NULL DEFAULT CURRENT_DATE,
  mandate_end DATE NOT NULL DEFAULT CURRENT_DATE,
  strategy_note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO crypto_paper_state (id, equity, cash, buying_power, day_pnl, week_pnl, status, mandate_start, mandate_end, strategy_note)
VALUES (1, 0, 0, 0, 0, 0, 'idle', '2026-09-08', '2026-09-12', 'Crypto-only paper trading')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS crypto_paper_positions (
  symbol TEXT PRIMARY KEY,
  quantity DOUBLE PRECISION NOT NULL,
  avg_price DOUBLE PRECISION NOT NULL,
  market_value DOUBLE PRECISION,
  unrealized_pnl DOUBLE PRECISION,
  theme TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crypto_paper_orders (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  filled_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_fill_price DOUBLE PRECISION,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  filled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS crypto_paper_orders_created_idx ON crypto_paper_orders (created_at DESC);

CREATE TABLE IF NOT EXISTS crypto_paper_journal (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crypto_paper_journal_created_idx ON crypto_paper_journal (created_at DESC);
