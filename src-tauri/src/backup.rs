use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::SqlitePool;

use crate::db;
use crate::health;

pub const MAX_BACKUP_BYTES: usize = 200_000_000;

/// Copia consistente de la base abierta.
/// `VACUUM INTO` escribe un archivo nuevo dentro de una lectura de SQLite.
/// No se copia `cartera.db` mientras el pool lo tiene abierto.
pub async fn snapshot_pool(pool: &SqlitePool, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| error.to_string())?;
    }
    let sql_path = destination.to_string_lossy().replace('\\', "/").replace('\'', "''");
    sqlx::raw_sql(&format!("VACUUM INTO '{sql_path}'"))
        .execute(pool)
        .await
        .map_err(|error| format!("No se pudo crear el snapshot de la base: {error}"))?;
    Ok(())
}

pub fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|_| "No se pudo leer el archivo.".to_string())?;
    if metadata.len() > MAX_BACKUP_BYTES as u64 {
        return Err("El archivo supera el tamaño admitido.".into());
    }
    fs::read(path).map_err(|error| error.to_string())
}

pub fn write_limited(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err("El archivo supera el tamaño admitido.".into());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, bytes).map_err(|error| error.to_string())
}

pub fn read_document_tree(documents_dir: &Path) -> Result<Vec<(String, Vec<u8>)>, String> {
    if !documents_dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    let mut total = 0usize;
    walk_documents(documents_dir, documents_dir, &mut files, &mut total)?;
    Ok(files)
}

fn walk_documents(
    root: &Path,
    directory: &Path,
    files: &mut Vec<(String, Vec<u8>)>,
    total: &mut usize,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.symlink_metadata().map(|meta| meta.file_type().is_symlink()).unwrap_or(false) {
            continue;
        }
        if path.is_dir() {
            walk_documents(root, &path, files, total)?;
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "Ruta de documento fuera de documents/.".to_string())?;
        let name = relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/");
        let bytes = read_limited(&path)?;
        *total = total.saturating_add(bytes.len());
        if *total > MAX_BACKUP_BYTES {
            return Err("Los documentos superan el tamaño admitido.".into());
        }
        files.push((name, bytes));
    }
    Ok(())
}

pub fn safe_backup_relative(relative: &str) -> Result<PathBuf, String> {
    if relative == "cartera.db" {
        return Ok(PathBuf::from("cartera.db"));
    }
    let Some(rest) = relative.strip_prefix("documents/") else {
        return Err("El backup tiene un archivo fuera de lugar.".into());
    };
    if rest.is_empty()
        || relative.contains('\\')
        || relative.starts_with('/')
        || relative.contains(':')
    {
        return Err("El backup tiene una ruta inválida.".into());
    }
    let path = Path::new(rest);
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("El backup tiene una ruta inválida.".into());
    }
    Ok(PathBuf::from("documents").join(path))
}

pub fn stage_restore_files(staging: &Path, files: &[(String, Vec<u8>)]) -> Result<(), String> {
    if staging.exists() {
        fs::remove_dir_all(staging).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(staging.join("documents")).map_err(|error| error.to_string())?;
    let mut total = 0usize;
    let mut saw_database = false;
    for (relative, bytes) in files {
        total = total.saturating_add(bytes.len());
        if total > MAX_BACKUP_BYTES {
            return Err("El backup supera el tamaño admitido.".into());
        }
        let relative_path = safe_backup_relative(relative)?;
        if relative_path == Path::new("cartera.db") {
            saw_database = true;
        }
        let destination = staging.join(&relative_path);
        write_limited(&destination, bytes)?;
    }
    if !saw_database {
        return Err("El backup no incluye cartera.db.".into());
    }
    Ok(())
}

pub async fn validate_staging(data_dir: &Path) -> Result<(), String> {
    let staged_database = data_dir.join("restore-staging").join("cartera.db");
    let staged_documents = data_dir.join("restore-staging").join("documents");
    if !staged_database.is_file() || !staged_documents.is_dir() {
        return Err("No hay un backup preparado para restaurar.".into());
    }
    let options = db::connect_options(&staged_database).create_if_missing(false);
    let staged_pool = db::connect(options).await.map_err(|error| error.to_string())?;
    let report = health::check_database(&staged_pool).await;
    staged_pool.close().await;
    report
}

pub async fn checkpoint_and_close(pool: SqlitePool) {
    let _ = sqlx::raw_sql("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&pool)
        .await;
    pool.close().await;
}

/// Mueve staging a su lugar. Si documents/ no entra, devuelve la base anterior.
/// En Windows estos renames no son una sola operación atómica.
pub fn swap_staged_files(config_dir: &Path, data_dir: &Path) -> Result<(), String> {
    let staging = data_dir.join("restore-staging");
    let staged_database = staging.join("cartera.db");
    let staged_documents = staging.join("documents");
    let database_path = config_dir.join("cartera.db");
    remove_sidecars(&database_path);
    let database_previous = config_dir.join("cartera.db.previous");
    let documents_path = data_dir.join("documents");
    let documents_previous = data_dir.join("documents.previous");

    move_aside(&database_path, &database_previous)?;
    if let Err(message) = move_into(&staged_database, &database_path) {
        let _ = undo(&database_path, &database_previous);
        return Err(message);
    }
    if let Err(message) = move_aside(&documents_path, &documents_previous) {
        let _ = undo(&database_path, &database_previous);
        return Err(message);
    }
    if let Err(message) = move_into(&staged_documents, &documents_path) {
        let _ = undo(&documents_path, &documents_previous);
        let _ = undo(&database_path, &database_previous);
        return Err(message);
    }
    Ok(())
}

pub fn rollback_previous(config_dir: &Path, data_dir: &Path) {
    let database_path = config_dir.join("cartera.db");
    let database_previous = config_dir.join("cartera.db.previous");
    let documents_path = data_dir.join("documents");
    let documents_previous = data_dir.join("documents.previous");
    if database_previous.exists() {
        let _ = undo(&database_path, &database_previous);
    }
    if documents_previous.exists() {
        let _ = undo(&documents_path, &documents_previous);
    }
}
pub fn safety_backup_path(data_dir: &Path) -> PathBuf {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    data_dir
        .join("backups")
        .join(format!("analisis-cartera-pre-restore-{seconds}.zip"))
}

pub fn path_is_inside(root: &Path, candidate: &Path) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let Ok(candidate) = candidate.canonicalize() else {
        return false;
    };
    candidate.starts_with(root)
}

fn move_aside(current: &Path, previous: &Path) -> Result<(), String> {
    if previous.exists() {
        remove_path(previous)?;
    }
    if current.exists() {
        fs::rename(current, previous).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn move_into(incoming: &Path, current: &Path) -> Result<(), String> {
    if let Some(parent) = current.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(incoming, current).map_err(|error| error.to_string())
}

fn undo(current: &Path, previous: &Path) -> Result<(), String> {
    if current.exists() {
        remove_path(current)?;
    }
    if previous.exists() {
        fs::rename(previous, current).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn remove_path(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn remove_sidecars(database_path: &Path) {
    let name = database_path.file_name().map(|name| name.to_os_string());
    let Some(name) = name else {
        return;
    };
    if let Some(parent) = database_path.parent() {
        for suffix in ["-wal", "-shm", "-journal"] {
            let mut sidecar = name.clone();
            sidecar.push(suffix);
            let _ = fs::remove_file(parent.join(sidecar));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_path_that_escapes_the_backup() {
        assert!(safe_backup_relative("../cartera.db").is_err());
        assert!(safe_backup_relative("documents/../cartera.db").is_err());
        assert!(safe_backup_relative("documents/2026/08/resumen.pdf").is_ok());
    }

    #[tokio::test]
    async fn vacuum_into_keeps_the_snapshot_stable_after_a_later_write() {
        let dir = std::env::temp_dir().join(format!(
            "cartera-vacuum-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        let pool = db::initialize(&dir).await.unwrap();
        sqlx::query("INSERT INTO portfolios (name, broker, base_currency) VALUES ('Una', 'BALANZ', 'ARS')")
            .execute(&pool)
            .await
            .unwrap();
        let snapshot = dir.join("snapshot.db");
        snapshot_pool(&pool, &snapshot).await.unwrap();
        sqlx::query("INSERT INTO portfolios (name, broker, base_currency) VALUES ('Dos', 'BALANZ', 'ARS')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let options = db::connect_options(&snapshot).create_if_missing(false);
        let copied = db::connect(options).await.unwrap();
        let names: Vec<String> = sqlx::query_scalar("SELECT name FROM portfolios ORDER BY id")
            .fetch_all(&copied)
            .await
            .unwrap();
        copied.close().await;
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(names, vec!["Una".to_string()]);
    }
}
