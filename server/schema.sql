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

ALTER TABLE marks ADD COLUMN IF NOT EXISTS day_pct DOUBLE PRECISION;
