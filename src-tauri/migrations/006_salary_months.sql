CREATE TABLE salary_months (
    month TEXT PRIMARY KEY CHECK(length(month) = 7),
    document TEXT NOT NULL CHECK(json_valid(document) AND length(document) <= 1000000),
    revision INTEGER NOT NULL CHECK(revision >= 1),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
