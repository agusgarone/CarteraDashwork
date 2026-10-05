use std::path::{Path, PathBuf};

use sqlx::SqlitePool;

pub const EXPECTED_MIGRATIONS: &[&str] = &["001", "002"];

pub struct HealthReport {
    pub ok: bool,
    pub message: Option<String>,
    pub missing_documents: Vec<String>,
}

pub async fn inspect(pool: &SqlitePool, data_dir: &Path) -> HealthReport {
    if let Err(message) = check_database(pool).await {
        return HealthReport {
            ok: false,
            message: Some(message),
            missing_documents: Vec::new(),
        };
    }

    HealthReport {
        ok: true,
        message: None,
        missing_documents: missing_documents(pool, data_dir).await,
    }
}

pub async fn check_database(pool: &SqlitePool) -> Result<(), String> {
    let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(pool)
        .await
        .map_err(|error| format!("No se pudo leer foreign_keys: {error}"))?;
    if foreign_keys != 1 {
        return Err("La base no tiene foreign keys activas.".into());
    }

    let checks: Vec<String> = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("No se pudo verificar la base: {error}"))?;
    if checks != ["ok".to_string()] {
        return Err("La base no pasa el control de integridad.".into());
    }

    let versions: Vec<String> =
        sqlx::query_scalar("SELECT version FROM schema_migrations ORDER BY version")
            .fetch_all(pool)
            .await
            .map_err(|error| format!("No se pudo leer el schema: {error}"))?;
    let expected: Vec<String> = EXPECTED_MIGRATIONS.iter().map(|version| (*version).to_string()).collect();
    if versions != expected {
        return Err(
            "La base no tiene el schema de esta versión. No se creó una base nueva encima.".into(),
        );
    }
    Ok(())
}

async fn missing_documents(pool: &SqlitePool, data_dir: &Path) -> Vec<String> {
    let paths: Vec<String> = match sqlx::query_scalar("SELECT local_path FROM documents ORDER BY id").fetch_all(pool).await {
        Ok(paths) => paths,
        Err(_) => return Vec::new(),
    };

    let mut missing = Vec::new();
    for relative in paths {
        let Some(absolute) = document_path(data_dir, &relative) else {
            missing.push(relative);
            continue;
        };
        if !absolute.is_file() {
            missing.push(relative);
        }
        if missing.len() == 20 {
            break;
        }
    }
    missing
}

fn document_path(data_dir: &Path, relative: &str) -> Option<PathBuf> {
    if relative.trim().is_empty()
        || relative.starts_with('/')
        || relative.starts_with('\\')
        || relative.contains(':')
    {
        return None;
    }
    let mut absolute = data_dir.to_path_buf();
    for part in relative.split(['/', '\\']) {
        if part.is_empty() || part == "." || part == ".." {
            return None;
        }
        absolute.push(part);
    }
    Some(absolute)
}
