use std::path::Path;

use serde::Deserialize;
use serde_json::{Map, Value as JsonValue};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Column, Row, Sqlite, SqlitePool, TypeInfo, ValueRef};

const SCHEMA_SQL: &str = include_str!("../migrations/001_initial_schema.sql");
const PROVENANCE_SQL: &str = include_str!("../migrations/002_import_provenance.sql");
const CASH_LEGS_SQL: &str = include_str!("../migrations/003_cash_movement_legs.sql");
const TRADE_COSTS_SQL: &str = include_str!("../migrations/004_trade_cost_components.sql");

const MIGRATIONS: &[(&str, &str)] = &[
    ("001", SCHEMA_SQL),
    ("002", PROVENANCE_SQL),
    ("003", CASH_LEGS_SQL),
    ("004", TRADE_COSTS_SQL),
];

/// Una referencia al `last_insert_rowid` de una sentencia anterior de la misma transacción.
#[derive(Debug, Deserialize)]
pub(crate) struct LastInsertRef {
    #[serde(rename = "lastInsertIdOf")]
    index: usize,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum TxParam {
    LastInsert(LastInsertRef),
    Literal(JsonValue),
}

#[derive(Debug, Deserialize)]
pub struct TxStatement {
    pub sql: String,
    pub params: Vec<TxParam>,
}

/// Pool de la aplicación. `foreign_keys(true)` hace que sqlx ejecute
/// `PRAGMA foreign_keys = ON` dentro de `connect()`, en cada conexión nueva.
pub fn connect_options(path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
}

pub async fn connect(options: SqliteConnectOptions) -> Result<SqlitePool, sqlx::Error> {
    sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
}

pub async fn apply_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );",
    )
    .execute(pool)
    .await?;

    for (version, sql) in MIGRATIONS {
        let applied: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM schema_migrations WHERE version = $1")
                .bind(version)
                .fetch_one(pool)
                .await?;
        if applied > 0 {
            continue;
        }

        // 001 incluye PRAGMA foreign_keys, que SQLite no acepta dentro de una transacción.
        // El archivo es idempotente. 002 corre en una transacción y solo se registra si termina.
        if *version == "001" {
            sqlx::raw_sql(sql).execute(pool).await?;
            sqlx::query("INSERT INTO schema_migrations (version) VALUES ($1)")
                .bind(version)
                .execute(pool)
                .await?;
            continue;
        }

        apply_transaction_migration(pool, sql, version).await?;
    }
    Ok(())
}

async fn apply_transaction_migration(
    pool: &SqlitePool,
    sql: &str,
    version: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::raw_sql(sql).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO schema_migrations (version) VALUES ($1)")
        .bind(version)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn initialize(app_config_dir: &Path) -> Result<SqlitePool, String> {
    std::fs::create_dir_all(app_config_dir).map_err(|error| error.to_string())?;
    let database_path = app_config_dir.join("cartera.db");
    // Si el archivo existe y está dañado, connect falla y el archivo queda donde está.
    // No se borra ni se reemplaza por una base nueva.
    let options = connect_options(&database_path).create_if_missing(!database_path.exists());
    let pool = connect(options).await.map_err(|error| error.to_string())?;
    apply_schema(&pool).await.map_err(|error| error.to_string())?;
    Ok(pool)
}

pub async fn count_portfolios(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM portfolios")
        .fetch_one(pool)
        .await
        .unwrap_or(0)
}

pub async fn select(
    pool: &SqlitePool,
    sql: &str,
    params: &[JsonValue],
) -> Result<Vec<Map<String, JsonValue>>, sqlx::Error> {
    let query = bind_literals(sqlx::query(sql), params)?;
    let rows = query.fetch_all(pool).await?;
    rows.iter().map(row_to_json).collect()
}

pub async fn execute(
    pool: &SqlitePool,
    sql: &str,
    params: &[JsonValue],
) -> Result<(i64, i64), sqlx::Error> {
    let query = bind_literals(sqlx::query(sql), params)?;
    let result = query.execute(pool).await?;
    Ok((
        i64::try_from(result.rows_affected()).unwrap_or(i64::MAX),
        result.last_insert_rowid(),
    ))
}

/// Todas las sentencias corren sobre la conexión que reserva `BEGIN`.
/// Si una falla, el `Drop` de la transacción hace `ROLLBACK`.
pub async fn run_transaction(
    pool: &SqlitePool,
    statements: &[TxStatement],
) -> Result<Vec<i64>, sqlx::Error> {
    if statements.is_empty() {
        return Err(sqlx::Error::Protocol(
            "la transacción no tiene sentencias".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let mut ids = Vec::with_capacity(statements.len());

    for statement in statements {
        let query = bind_transaction(sqlx::query(&statement.sql), &statement.params, &ids)?;
        let result = query.execute(&mut *tx).await?;
        ids.push(result.last_insert_rowid());
    }

    tx.commit().await?;
    Ok(ids)
}

fn bind_literals<'a>(
    mut query: sqlx::query::Query<'a, Sqlite, sqlx::sqlite::SqliteArguments<'a>>,
    params: &'a [JsonValue],
) -> Result<sqlx::query::Query<'a, Sqlite, sqlx::sqlite::SqliteArguments<'a>>, sqlx::Error> {
    for param in params {
        query = bind_json(query, param)?;
    }
    Ok(query)
}

fn bind_transaction<'a>(
    mut query: sqlx::query::Query<'a, Sqlite, sqlx::sqlite::SqliteArguments<'a>>,
    params: &'a [TxParam],
    ids: &[i64],
) -> Result<sqlx::query::Query<'a, Sqlite, sqlx::sqlite::SqliteArguments<'a>>, sqlx::Error> {
    for param in params {
        query = match param {
            TxParam::Literal(value) => bind_json(query, value)?,
            TxParam::LastInsert(reference) => {
                let id = ids.get(reference.index).copied().ok_or_else(|| {
                    sqlx::Error::Protocol(
                        format!(
                            "lastInsertIdOf {} no corresponde a una sentencia anterior",
                            reference.index
                        )
                        .into(),
                    )
                })?;
                query.bind(id)
            }
        };
    }
    Ok(query)
}

fn bind_json<'a>(
    query: sqlx::query::Query<'a, Sqlite, sqlx::sqlite::SqliteArguments<'a>>,
    value: &'a JsonValue,
) -> Result<sqlx::query::Query<'a, Sqlite, sqlx::sqlite::SqliteArguments<'a>>, sqlx::Error> {
    Ok(match value {
        JsonValue::Null => query.bind(None::<i64>),
        JsonValue::String(text) => query.bind(text),
        JsonValue::Number(number) => {
            if let Some(integer) = number.as_i64() {
                query.bind(integer)
            } else if let Some(real) = number.as_f64() {
                query.bind(real)
            } else {
                return Err(sqlx::Error::Protocol(
                    "número de parámetro fuera de rango".into(),
                ));
            }
        }
        JsonValue::Bool(value) => query.bind(i64::from(*value)),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            return Err(sqlx::Error::Protocol(
                "parámetro SQL no soportado".into(),
            ));
        }
    })
}

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Result<Map<String, JsonValue>, sqlx::Error> {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        object.insert(column.name().to_owned(), cell_to_json(row, index)?);
    }
    Ok(object)
}

fn cell_to_json(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
) -> Result<JsonValue, sqlx::Error> {
    let raw = row.try_get_raw(index)?;
    if raw.is_null() {
        return Ok(JsonValue::Null);
    }

    match raw.type_info().name() {
        "INTEGER" | "INT" | "NUMERIC" => Ok(JsonValue::Number(row.try_get::<i64, _>(index)?.into())),
        "REAL" | "FLOAT" | "DOUBLE" => {
            let value: f64 = row.try_get(index)?;
            serde_json::Number::from_f64(value)
                .map(JsonValue::Number)
                .ok_or_else(|| sqlx::Error::Protocol("REAL no representable en JSON".into()))
        }
        "TEXT" => Ok(JsonValue::String(row.try_get(index)?)),
        other => Err(sqlx::Error::Protocol(
            format!("tipo SQLite no soportado: {other}").into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    async fn test_pool() -> SqlitePool {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .unwrap();
        apply_schema(&pool).await.unwrap();

        let mut connections = Vec::new();
        for _ in 0..4 {
            connections.push(pool.acquire().await.unwrap());
        }
        drop(connections);
        pool
    }

    async fn seed_snapshot(pool: &SqlitePool) -> (i64, i64, i64) {
        let portfolio_id = sqlx::query(
            "INSERT INTO portfolios (name, broker, base_currency) VALUES ('Mi cartera', 'BALANZ', 'ARS')",
        )
        .execute(pool)
        .await
        .unwrap()
        .last_insert_rowid();

        let period_id = sqlx::query(
            "INSERT INTO periods (portfolio_id, year, month, status) VALUES ($1, 2026, 8, 'PENDING')",
        )
        .bind(portfolio_id)
        .execute(pool)
        .await
        .unwrap()
        .last_insert_rowid();

        let instrument_id = sqlx::query(
            "INSERT INTO instruments (ticker, name, category, currency, broker_identifier) VALUES ('GGAL', NULL, 'STOCK', 'ARS', NULL)",
        )
        .execute(pool)
        .await
        .unwrap()
        .last_insert_rowid();

        let snapshot_id = sqlx::query(
            "INSERT INTO snapshots (portfolio_id, period_id, date, total_value, currency, source_document_id) VALUES ($1, $2, '2026-08-31', '26383988.00', 'ARS', NULL)",
        )
        .bind(portfolio_id)
        .bind(period_id)
        .execute(pool)
        .await
        .unwrap()
        .last_insert_rowid();

        (snapshot_id, instrument_id, period_id)
    }

    async fn count(pool: &SqlitePool, table: &str) -> i64 {
        let sql = format!("SELECT COUNT(*) FROM {table}");
        sqlx::query_scalar(&sql).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn missing_instrument_foreign_key_fails() {
        let pool = test_pool().await;
        let (snapshot_id, _instrument_id, _period_id) = seed_snapshot(&pool).await;

        let error = sqlx::query(
            "INSERT INTO positions (snapshot_id, instrument_id, quantity, unit_price, market_value, currency) VALUES ($1, 999999, '1', '1', '1', 'ARS')",
        )
        .bind(snapshot_id)
        .execute(&pool)
        .await
        .unwrap_err();

        assert!(
            error.to_string().contains("FOREIGN KEY constraint failed"),
            "el error fue: {error}"
        );
        assert_eq!(count(&pool, "positions").await, 0);
    }

    #[tokio::test]
    async fn deleting_snapshot_removes_positions() {
        let pool = test_pool().await;
        let (snapshot_id, instrument_id, _period_id) = seed_snapshot(&pool).await;
        let other_instrument_id = sqlx::query(
            "INSERT INTO instruments (ticker, name, category, currency, broker_identifier) VALUES ('SPY', NULL, 'CEDEAR', 'ARS', NULL)",
        )
        .execute(&pool)
        .await
        .unwrap()
        .last_insert_rowid();

        for instrument in [instrument_id, other_instrument_id] {
            sqlx::query(
                "INSERT INTO positions (snapshot_id, instrument_id, quantity, unit_price, market_value, currency) VALUES ($1, $2, '1', '1', '1', 'ARS')",
            )
            .bind(snapshot_id)
            .bind(instrument)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO cash_balances (snapshot_id, currency, amount, fx_rate, value_in_base_currency) VALUES ($1, 'ARS', '10.00', NULL, NULL)",
        )
        .bind(snapshot_id)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(count(&pool, "positions").await, 2);
        assert_eq!(count(&pool, "cash_balances").await, 1);

        sqlx::query("DELETE FROM snapshots WHERE id = $1")
            .bind(snapshot_id)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(count(&pool, "positions").await, 0);
        assert_eq!(count(&pool, "cash_balances").await, 0);
    }

    #[tokio::test]
    async fn aggregate_rolls_back_when_a_later_insert_fails() {
        let pool = test_pool().await;
        let (portfolio_id, _ignored_snapshot, period_id) = {
            let (snapshot_id, instrument_id, period_id) = seed_snapshot(&pool).await;
            let portfolio_id: i64 = sqlx::query_scalar("SELECT portfolio_id FROM snapshots WHERE id = $1")
                .bind(snapshot_id)
                .fetch_one(&pool)
                .await
                .unwrap();
            (portfolio_id, instrument_id, period_id)
        };
        let instrument_id: i64 = sqlx::query_scalar("SELECT id FROM instruments LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();

        let statements = vec![
            TxStatement {
                sql: "INSERT INTO snapshots (portfolio_id, period_id, date, total_value, currency, source_document_id) VALUES ($1, $2, '2026-08-29', '10.00', 'ARS', NULL)".into(),
                params: vec![
                    TxParam::Literal(JsonValue::from(portfolio_id)),
                    TxParam::Literal(JsonValue::from(period_id)),
                ],
            },
            TxStatement {
                sql: "INSERT INTO cash_balances (snapshot_id, currency, amount, fx_rate, value_in_base_currency) VALUES ($1, 'ARS', '10.00', NULL, NULL)".into(),
                params: vec![TxParam::LastInsert(LastInsertRef { index: 0 })],
            },
            TxStatement {
                sql: "INSERT INTO positions (snapshot_id, instrument_id, quantity, unit_price, market_value, currency) VALUES ($1, $2, '1', '1', '1', 'ARS')".into(),
                params: vec![
                    TxParam::LastInsert(LastInsertRef { index: 0 }),
                    TxParam::Literal(JsonValue::from(instrument_id)),
                ],
            },
            TxStatement {
                sql: "INSERT INTO positions (snapshot_id, instrument_id, quantity, unit_price, market_value, currency) VALUES ($1, 999999, '1', '1', '1', 'ARS')".into(),
                params: vec![TxParam::LastInsert(LastInsertRef { index: 0 })],
            },
        ];

        let snapshots_before = count(&pool, "snapshots").await;
        let error = run_transaction(&pool, &statements).await.unwrap_err();
        assert!(
            error.to_string().contains("FOREIGN KEY constraint failed"),
            "el error fue: {error}"
        );
        assert_eq!(count(&pool, "snapshots").await, snapshots_before);
        assert_eq!(count(&pool, "positions").await, 0);
        assert_eq!(count(&pool, "cash_balances").await, 0);

        let rolled_back: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM snapshots WHERE date = '2026-08-29'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rolled_back, 0);
    }

    #[tokio::test]
    async fn schema_migrations_records_001_and_002() {
        let pool = test_pool().await;
        let versions: Vec<String> =
            sqlx::query_scalar("SELECT version FROM schema_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            versions,
            vec![
                "001".to_string(),
                "002".to_string(),
                "003".to_string(),
                "004".to_string(),
            ]
        );

        let sources: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'position_field_sources'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(sources, 1);

        let legs: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'cash_movement_legs'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(legs, 1);
    }
}
