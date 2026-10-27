CREATE TABLE IF NOT EXISTS transaction_fx_enrichments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    fx_rate TEXT NOT NULL,
    fx_kind TEXT NOT NULL
        CHECK(fx_kind IN ('MEP', 'CCL', 'OFFICIAL')),
    fx_date TEXT NOT NULL,
    source_document_id INTEGER NOT NULL,
    source_sheet TEXT NOT NULL,
    source_row INTEGER NOT NULL,
    source_column TEXT NOT NULL,
    operation_reference TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (transaction_id)
        REFERENCES transactions(id)
        ON DELETE CASCADE,

    FOREIGN KEY (source_document_id)
        REFERENCES documents(id),

    UNIQUE(transaction_id)
);
