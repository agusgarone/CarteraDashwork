CREATE TABLE cash_movement_legs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL,
    operation_reference TEXT,
    operation_type TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount TEXT NOT NULL,
    leg_date TEXT NOT NULL,
    role TEXT NOT NULL,

    FOREIGN KEY (period_id)
        REFERENCES periods(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_cash_movement_legs_period
ON cash_movement_legs(period_id);
