PRAGMA foreign_keys = ON;

-- =========================================================
-- PORTFOLIOS
-- =========================================================

CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    broker TEXT NOT NULL,
    base_currency TEXT NOT NULL DEFAULT 'ARS',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- PERIODS
-- Un período mensual de la cartera.
-- Ej: Agosto 2026
-- =========================================================

CREATE TABLE IF NOT EXISTS periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portfolio_id INTEGER NOT NULL,

    year INTEGER NOT NULL,
    month INTEGER NOT NULL,

    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING', 'PROCESSING', 'COMPLETE', 'ERROR')),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,

    FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(id)
        ON DELETE CASCADE,

    UNIQUE(portfolio_id, year, month)
);


-- =========================================================
-- DOCUMENTS
-- PDFs / Excel originales importados
-- =========================================================

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL,

    type TEXT NOT NULL
        CHECK(type IN (
            'CONSOLIDATED_POSITION',
            'PERIOD_RESULTS',
            'MONTHLY_ACCOUNT',
            'MONTHLY_FUND_STATEMENT',
            'OTHER'
        )),

    original_filename TEXT NOT NULL,
    local_path TEXT NOT NULL,

    sha256 TEXT NOT NULL,

    processing_status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK(processing_status IN (
            'PENDING',
            'PROCESSING',
            'PROCESSED',
            'ERROR'
        )),

    parser_version TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (period_id)
        REFERENCES periods(id)
        ON DELETE CASCADE,

    UNIQUE(sha256)
);


-- =========================================================
-- INSTRUMENTS
-- META, SPY, PLC4O, GGAL, etc.
-- =========================================================

CREATE TABLE IF NOT EXISTS instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    ticker TEXT NOT NULL,
    name TEXT,

    category TEXT NOT NULL
        CHECK(category IN (
            'CEDEAR',
            'STOCK',
            'CORPORATE_BOND',
            'BOND',
            'FUND',
            'OTHER'
        )),

    currency TEXT NOT NULL,

    broker_identifier TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(ticker, category)
);


-- =========================================================
-- SNAPSHOTS
-- Estado total de la cartera en determinada fecha
-- =========================================================

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    portfolio_id INTEGER NOT NULL,
    period_id INTEGER NOT NULL,

    date TEXT NOT NULL,

    total_value TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'ARS',

    source_document_id INTEGER,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(id),

    FOREIGN KEY (period_id)
        REFERENCES periods(id)
        ON DELETE CASCADE,

    FOREIGN KEY (source_document_id)
        REFERENCES documents(id),

    UNIQUE(portfolio_id, date)
);


-- =========================================================
-- POSITIONS
-- Qué instrumentos componían un snapshot
-- =========================================================

CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    snapshot_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,

    quantity TEXT NOT NULL,
    unit_price TEXT NOT NULL,
    market_value TEXT NOT NULL,

    currency TEXT NOT NULL,

    FOREIGN KEY (snapshot_id)
        REFERENCES snapshots(id)
        ON DELETE CASCADE,

    FOREIGN KEY (instrument_id)
        REFERENCES instruments(id),

    UNIQUE(snapshot_id, instrument_id)
);


-- =========================================================
-- CASH BALANCES
-- ARS / USD MEP / USD Cable
-- =========================================================

CREATE TABLE IF NOT EXISTS cash_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    snapshot_id INTEGER NOT NULL,

    currency TEXT NOT NULL,

    amount TEXT NOT NULL,

    fx_rate TEXT,
    value_in_base_currency TEXT,

    FOREIGN KEY (snapshot_id)
        REFERENCES snapshots(id)
        ON DELETE CASCADE,

    UNIQUE(snapshot_id, currency)
);


-- =========================================================
-- TRANSACTIONS
-- Movimientos económicos
-- =========================================================

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    portfolio_id INTEGER NOT NULL,
    period_id INTEGER NOT NULL,

    instrument_id INTEGER,

    date TEXT NOT NULL,

    type TEXT NOT NULL
        CHECK(type IN (
            'CONTRIBUTION',
            'WITHDRAWAL',
            'BUY',
            'SELL',
            'DIVIDEND',
            'INTEREST',
            'FUND_SUBSCRIPTION',
            'FUND_REDEMPTION',
            'FEE',
            'TAX',
            'FX_CONVERSION',
            'OTHER'
        )),

    quantity TEXT,
    unit_price TEXT,

    gross_amount TEXT,
    net_amount TEXT,

    fees TEXT,
    taxes TEXT,

    currency TEXT NOT NULL,

    fx_rate TEXT,

    source_document_id INTEGER,
    source_reference TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(id),

    FOREIGN KEY (period_id)
        REFERENCES periods(id)
        ON DELETE CASCADE,

    FOREIGN KEY (instrument_id)
        REFERENCES instruments(id),

    FOREIGN KEY (source_document_id)
        REFERENCES documents(id)
);


-- =========================================================
-- CORPORATE ACTIONS
-- Split, dividendos en acciones, etc.
-- =========================================================

CREATE TABLE IF NOT EXISTS corporate_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    portfolio_id INTEGER NOT NULL,
    period_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,

    date TEXT NOT NULL,

    type TEXT NOT NULL
        CHECK(type IN (
            'STOCK_DIVIDEND',
            'SPLIT',
            'REVERSE_SPLIT',
            'RATIO_CHANGE',
            'OTHER'
        )),

    quantity_before TEXT,
    quantity_change TEXT,
    quantity_after TEXT,

    ratio TEXT,

    description TEXT,

    source_document_id INTEGER,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (portfolio_id)
        REFERENCES portfolios(id),

    FOREIGN KEY (period_id)
        REFERENCES periods(id)
        ON DELETE CASCADE,

    FOREIGN KEY (instrument_id)
        REFERENCES instruments(id),

    FOREIGN KEY (source_document_id)
        REFERENCES documents(id)
);


-- =========================================================
-- RECONCILIATION
-- Resultado de validar que un período cierre correctamente
-- =========================================================

CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    period_id INTEGER NOT NULL,

    opening_value TEXT NOT NULL,
    closing_value TEXT NOT NULL,

    contributions TEXT NOT NULL,
    withdrawals TEXT NOT NULL,

    expected_result TEXT NOT NULL,
    explained_result TEXT NOT NULL,

    difference TEXT NOT NULL,

    status TEXT NOT NULL
        CHECK(status IN (
            'RECONCILED',
            'WARNING',
            'FAILED'
        )),

    engine_version TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (period_id)
        REFERENCES periods(id)
        ON DELETE CASCADE
);


-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_periods_portfolio
ON periods(portfolio_id);

CREATE INDEX IF NOT EXISTS idx_transactions_period
ON transactions(period_id);

CREATE INDEX IF NOT EXISTS idx_transactions_instrument
ON transactions(instrument_id);

CREATE INDEX IF NOT EXISTS idx_transactions_date
ON transactions(date);

CREATE INDEX IF NOT EXISTS idx_positions_snapshot
ON positions(snapshot_id);