CREATE TABLE position_field_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER NOT NULL,
    field_name TEXT NOT NULL
        CHECK(field_name IN ('quantity', 'unit_price', 'market_value')),
    document_id INTEGER NOT NULL,
    source_reference TEXT,
    as_of_date TEXT NOT NULL,

    FOREIGN KEY (position_id)
        REFERENCES positions(id)
        ON DELETE CASCADE,

    FOREIGN KEY (document_id)
        REFERENCES documents(id),

    UNIQUE(position_id, field_name)
);

-- Diagnóstico del import. No entra en el cálculo del PortfolioEngine.
CREATE TABLE snapshot_source_reconciliations (
    snapshot_id INTEGER PRIMARY KEY,
    raw_difference TEXT NOT NULL,
    enriched_difference TEXT NOT NULL,

    FOREIGN KEY (snapshot_id)
        REFERENCES snapshots(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_position_field_sources_position
ON position_field_sources(position_id);
