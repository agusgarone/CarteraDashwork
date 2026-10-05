mod backup;
mod db;
mod health;
mod sql_guard;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Map, Value as JsonValue};
use sqlx::SqlitePool;
use tauri::Manager;
use tokio::sync::Mutex;

pub const APP_IDENTIFIER: &str = "com.analisiscartera.app";

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    if tokio::runtime::Handle::try_current().is_ok() {
        tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(future))
    } else {
        tauri::async_runtime::block_on(future)
    }
}

struct Inner {
    pool: Option<SqlitePool>,
    startup_error: Option<String>,
}

struct AppState {
    inner: Arc<Mutex<Inner>>,
    config_dir: PathBuf,
    data_dir: PathBuf,
}

impl AppState {
    async fn pool(&self) -> Result<SqlitePool, String> {
        let inner = self.inner.lock().await;
        if inner.pool.is_none() {
            if let Some(error) = &inner.startup_error {
                return Err(error.clone());
            }
        }
        inner
            .pool
            .clone()
            .ok_or_else(|| "La base no está disponible.".to_string())
    }

    fn failed(config_dir: PathBuf, data_dir: PathBuf, message: String) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                pool: None,
                startup_error: Some(message),
            })),
            config_dir,
            data_dir,
        }
    }
}

/// Los repositorios siguen mandando SQL, limitado a una sentencia SELECT, INSERT o UPDATE.
/// Backup, restauración y health usan comandos con nombre.
#[tauri::command]
async fn db_select(
    state: tauri::State<'_, AppState>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<Vec<Map<String, JsonValue>>, String> {
    sql_guard::allow_webview_sql(&sql)?;
    let pool = state.pool().await?;
    db::select(&pool, &sql, &params)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn db_execute(
    state: tauri::State<'_, AppState>,
    sql: String,
    params: Vec<JsonValue>,
) -> Result<ExecuteResponse, String> {
    sql_guard::allow_webview_sql(&sql)?;
    let pool = state.pool().await?;
    let (rows_affected, last_insert_id) = db::execute(&pool, &sql, &params)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ExecuteResponse {
        rows_affected,
        last_insert_id,
    })
}

#[tauri::command]
async fn db_transaction(
    state: tauri::State<'_, AppState>,
    statements: Vec<db::TxStatement>,
) -> Result<TransactionResponse, String> {
    for statement in &statements {
        sql_guard::allow_webview_sql(&statement.sql)?;
    }
    let pool = state.pool().await?;
    let last_insert_ids = db::run_transaction(&pool, &statements)
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppPathsResponse {
    app_version: &'static str,
    app_identifier: &'static str,
    config_dir: String,
    data_dir: String,
    database_path: String,
    documents_dir: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    ok: bool,
    message: Option<String>,
    missing_documents: Vec<String>,
    app_version: &'static str,
    app_identifier: &'static str,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentFile {
    relative_path: String,
    bytes: Vec<u8>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreFile {
    relative_path: String,
    bytes: Vec<u8>,
}

#[tauri::command]
fn app_paths(state: tauri::State<'_, AppState>) -> AppPathsResponse {
    AppPathsResponse {
        app_version: env!("CARGO_PKG_VERSION"),
        app_identifier: APP_IDENTIFIER,
        config_dir: path_text(&state.config_dir),
        data_dir: path_text(&state.data_dir),
        database_path: path_text(&state.config_dir.join("cartera.db")),
        documents_dir: path_text(&state.data_dir.join("documents")),
    }
}

#[tauri::command]
async fn app_health(state: tauri::State<'_, AppState>) -> Result<HealthResponse, String> {
    if let Ok(pool) = state.pool().await {
        let report = health::inspect(&pool, &state.data_dir).await;
        return Ok(HealthResponse {
            ok: report.ok,
            message: report.message,
            missing_documents: report.missing_documents,
            app_version: env!("CARGO_PKG_VERSION"),
            app_identifier: APP_IDENTIFIER,
        });
    }
    let inner = state.inner.lock().await;
    Ok(HealthResponse {
        ok: false,
        message: inner.startup_error.clone(),
        missing_documents: Vec::new(),
        app_version: env!("CARGO_PKG_VERSION"),
        app_identifier: APP_IDENTIFIER,
    })
}

#[tauri::command]
async fn snapshot_database(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let pool = state.pool().await?;
    let destination = state.data_dir.join("backup-work").join(format!(
        "snapshot-{}.db",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    backup::snapshot_pool(&pool, &destination).await?;
    Ok(path_text(&destination))
}

#[tauri::command]
fn read_app_file(state: tauri::State<'_, AppState>, path: String) -> Result<Vec<u8>, String> {
    let candidate = PathBuf::from(&path);
    if !backup::path_is_inside(&state.config_dir, &candidate)
        && !backup::path_is_inside(&state.data_dir, &candidate)
    {
        return Err("Ese archivo no está en los datos de la aplicación.".into());
    }
    backup::read_limited(&candidate)
}

#[tauri::command]
fn read_documents(state: tauri::State<'_, AppState>) -> Result<Vec<DocumentFile>, String> {
    let files = backup::read_document_tree(&state.data_dir.join("documents"))?;
    Ok(files
        .into_iter()
        .map(|(relative_path, bytes)| DocumentFile {
            relative_path,
            bytes,
        })
        .collect())
}

#[tauri::command]
fn write_user_file(
    state: tauri::State<'_, AppState>,
    path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let destination = PathBuf::from(&path);
    reject_live_target(&state, &destination)?;
    backup::write_limited(&destination, &bytes)
}

#[tauri::command]
fn read_user_file(path: String) -> Result<Vec<u8>, String> {
    backup::read_limited(Path::new(&path))
}

#[tauri::command]
fn remove_app_file(state: tauri::State<'_, AppState>, path: String) -> Result<(), String> {
    let candidate = PathBuf::from(&path);
    let work = state.data_dir.join("backup-work");
    if !backup::path_is_inside(&work, &candidate) {
        return Err("Solo se puede borrar un snapshot temporal.".into());
    }
    if candidate.is_file() {
        std::fs::remove_file(&candidate).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn has_user_data(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let documents = backup::read_document_tree(&state.data_dir.join("documents"))?;
    if !documents.is_empty() {
        return Ok(true);
    }
    if let Ok(pool) = state.pool().await {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM portfolios")
            .fetch_one(&pool)
            .await
            .unwrap_or(0);
        return Ok(count > 0);
    }
    Ok(state.config_dir.join("cartera.db").is_file())
}

#[tauri::command]
fn write_safety_backup(state: tauri::State<'_, AppState>, bytes: Vec<u8>) -> Result<String, String> {
    let path = backup::safety_backup_path(&state.data_dir);
    backup::write_limited(&path, &bytes)?;
    Ok(path_text(&path))
}

#[tauri::command]
fn stage_restore(state: tauri::State<'_, AppState>, files: Vec<RestoreFile>) -> Result<(), String> {
    let files = files
        .into_iter()
        .map(|file| (file.relative_path, file.bytes))
        .collect::<Vec<_>>();
    backup::stage_restore_files(&state.data_dir.join("restore-staging"), &files)
}

/// Síncrono a propósito: el futuro de sqlx no cumple el `Send` que exige un comando async.
/// `block_on` corre la restauración en el runtime y el comando no retiene `State` entre esperas.
#[tauri::command]
fn commit_restore(
    state: tauri::State<'_, AppState>,
    safety_zip: Option<String>,
) -> Result<(), String> {
    let inner = Arc::clone(&state.inner);
    let config_dir = state.config_dir.clone();
    let data_dir = state.data_dir.clone();
    block_on(restore_owned(inner, config_dir, data_dir, safety_zip))
}

async fn restore_owned(
    inner_state: Arc<Mutex<Inner>>,
    config_dir: PathBuf,
    data_dir: PathBuf,
    safety_zip: Option<String>,
) -> Result<(), String> {
    let documents = backup::read_document_tree(&data_dir.join("documents"))?;
    let mut needs_safety = !documents.is_empty();
    if !needs_safety {
        let pool = {
            let inner = inner_state.lock().await;
            inner.pool.clone()
        };
        if let Some(pool) = pool {
            needs_safety = db::count_portfolios(&pool).await > 0;
        } else {
            needs_safety = config_dir.join("cartera.db").is_file();
        }
    }
    if needs_safety {
        let path = safety_zip.ok_or("Antes de restaurar hay que guardar una copia de los datos actuales.")?;
        let safety = PathBuf::from(path);
        let backups = data_dir.join("backups");
        if !backup::path_is_inside(&backups, &safety) {
            return Err("La copia previa no está en la carpeta de backups.".into());
        }
        let metadata = std::fs::metadata(&safety).map_err(|_| "No se encontró la copia previa.".to_string())?;
        if metadata.len() == 0 {
            return Err("La copia previa está vacía.".into());
        }
    }

    let pool = {
        let mut inner = inner_state.lock().await;
        inner.pool.take()
    };
    if let Err(message) = backup::validate_staging(&data_dir).await {
        let mut inner = inner_state.lock().await;
        inner.pool = pool;
        return Err(message);
    }
    if let Some(pool) = pool {
        backup::checkpoint_and_close(pool).await;
    }
    if let Err(message) = backup::swap_staged_files(&config_dir, &data_dir) {
        return store_reopened_pool(inner_state, &config_dir, message).await;
    }
    match db::initialize(&config_dir).await {
        Ok(opened) => match health::check_database(&opened).await {
            Ok(()) => {
                let _ = std::fs::remove_file(config_dir.join("cartera.db.previous"));
                let _ = std::fs::remove_dir_all(data_dir.join("documents.previous"));
                let mut inner = inner_state.lock().await;
                inner.startup_error = None;
                inner.pool = Some(opened);
                Ok(())
            }
            Err(message) => {
                opened.close().await;
                backup::rollback_previous(&config_dir, &data_dir);
                store_reopened_pool(inner_state, &config_dir, message).await
            }
        },
        Err(message) => {
            backup::rollback_previous(&config_dir, &data_dir);
            store_reopened_pool(inner_state, &config_dir, message).await
        }
    }
}

async fn store_reopened_pool(
    inner_state: Arc<Mutex<Inner>>,
    config_dir: &Path,
    message: String,
) -> Result<(), String> {
    match db::initialize(config_dir).await {
        Ok(pool) => {
            let mut inner = inner_state.lock().await;
            inner.pool = Some(pool);
            Err(message)
        }
        Err(open_error) => {
            let mut inner = inner_state.lock().await;
            inner.pool = None;
            inner.startup_error = Some(format!("{message} {open_error}"));
            Err(message)
        }
    }
}

fn reject_live_target(state: &AppState, destination: &Path) -> Result<(), String> {
    let database = state.config_dir.join("cartera.db");
    if destination == database {
        return Err("No se puede escribir encima de la base en uso.".into());
    }
    let documents = state.data_dir.join("documents");
    if documents.exists() && backup::path_is_inside(&documents, destination_or_parent(destination)) {
        return Err("No se guarda el backup dentro de los documentos importados.".into());
    }
    Ok(())
}

fn destination_or_parent(path: &Path) -> &Path {
    if path.exists() { path } else { path.parent().unwrap_or(path) }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

async fn bootstrap(config_dir: PathBuf, data_dir: PathBuf, identifier: String) -> AppState {
    if identifier != APP_IDENTIFIER {
        return AppState::failed(
            config_dir,
            data_dir,
            format!("El identificador de la app es {identifier}."),
        );
    }
    let _ = std::fs::create_dir_all(&data_dir);
    match db::initialize(&config_dir).await {
        Ok(pool) => {
            let report = health::inspect(&pool, &data_dir).await;
            if report.ok {
                AppState {
                    inner: Arc::new(Mutex::new(Inner {
                        pool: Some(pool),
                        startup_error: None,
                    })),
                    config_dir,
                    data_dir,
                }
            } else {
                pool.close().await;
                AppState::failed(
                    config_dir,
                    data_dir,
                    report
                        .message
                        .unwrap_or_else(|| "La base no se puede usar. No se creó una base nueva.".into()),
                )
            }
        }
        Err(error) => AppState::failed(
            config_dir,
            data_dir,
            format!("{error} No se creó una base nueva encima del archivo existente."),
        ),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_execute,
            db_transaction,
            app_paths,
            app_health,
            snapshot_database,
            read_app_file,
            read_documents,
            write_user_file,
            read_user_file,
            remove_app_file,
            has_user_data,
            write_safety_backup,
            stage_restore,
            commit_restore
        ])
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            let identifier = app.config().identifier.clone();
            let state = block_on(bootstrap(config_dir, data_dir, identifier));
            app.manage(state);
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
