mod db;

use serde_json::{Map, Value as JsonValue};
use sqlx::SqlitePool;
use tauri::Manager;

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    if tokio::runtime::Handle::try_current().is_ok() {
        tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(future))
    } else {
        tauri::async_runtime::block_on(future)
    }
}

#[tauri::command]
async fn db_select(
    pool: tauri::State<'_, SqlitePool>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<Vec<Map<String, JsonValue>>, String> {
    db::select(pool.inner(), &sql, &params)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn db_execute(
    pool: tauri::State<'_, SqlitePool>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<ExecuteResponse, String> {
    let (rows_affected, last_insert_id) = db::execute(pool.inner(), &sql, &params)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ExecuteResponse {
        rows_affected,
        last_insert_id,
    })
}

#[tauri::command]
async fn db_transaction(
    pool: tauri::State<'_, SqlitePool>,
    statements: Vec<db::TxStatement>,
) -> Result<TransactionResponse, String> {
    let last_insert_ids = db::run_transaction(pool.inner(), &statements)
        .await
        .map_err(|error| error.to_string())?;
    Ok(TransactionResponse { last_insert_ids })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResponse {
    rows_affected: i64,
    last_insert_id: i64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TransactionResponse {
    last_insert_ids: Vec<i64>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_execute,
            db_transaction
        ])
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let pool = block_on(db::initialize(&dir))?;
            app.manage(pool);
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
