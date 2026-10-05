/// El webview sigue enviando el SQL de los repositorios.
/// Acá se rechaza todo lo que no sea una sola sentencia SELECT, INSERT o UPDATE.
/// Los tests de repositorio usan node:sqlite y no pasan por estos comandos.

pub fn allow_webview_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err("La consulta no es válida.".into());
    }
    let body = trimmed.trim_end_matches(';').trim();
    if body.contains(';') || body.contains("--") || body.contains("/*") || body.contains("*/") {
        return Err("Solo se permite una sentencia, sin comentarios.".into());
    }

    let upper = body.to_ascii_uppercase();
    if !starts_with_allowed(&upper) {
        return Err("Solo se permiten consultas de lectura o de guardado.".into());
    }

    for keyword in [
        "ATTACH",
        "DETACH",
        "VACUUM",
        "PRAGMA",
        "DROP",
        "ALTER",
        "CREATE",
        "DELETE",
        "REPLACE",
        "LOAD_EXTENSION",
        "SQLITE_MASTER",
        "SQLITE_TEMP_MASTER",
    ] {
        if has_word(&upper, keyword) {
            return Err("Esa sentencia no está permitida.".into());
        }
    }
    Ok(())
}

fn starts_with_allowed(sql: &str) -> bool {
    for prefix in ["SELECT", "INSERT", "UPDATE"] {
        let Some(rest) = sql.strip_prefix(prefix) else {
            continue;
        };
        return rest.is_empty()
            || rest.starts_with(|character: char| character.is_whitespace())
            || rest.starts_with('(');
    }
    false
}

fn has_word(sql: &str, keyword: &str) -> bool {
    sql.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .any(|word| word == keyword)
}

#[cfg(test)]
mod tests {
    use super::allow_webview_sql;

    #[test]
    fn allows_repository_statements() {
        assert!(allow_webview_sql("SELECT id FROM portfolios WHERE id = $1").is_ok());
        assert!(allow_webview_sql(
            "INSERT INTO portfolios (name, broker, base_currency) VALUES ($1, $2, $3)"
        )
        .is_ok());
        assert!(allow_webview_sql("UPDATE periods SET status = $1, completed_at = $2 WHERE id = $3").is_ok());
    }

    #[test]
    fn rejects_schema_and_multiple_statements() {
        assert!(allow_webview_sql("DROP TABLE portfolios").is_err());
        assert!(allow_webview_sql("PRAGMA foreign_keys = OFF").is_err());
        assert!(allow_webview_sql("VACUUM INTO 'otra.db'").is_err());
        assert!(allow_webview_sql("ATTACH DATABASE 'otra.db' AS otra").is_err());
        assert!(allow_webview_sql("SELECT 1; DROP TABLE portfolios").is_err());
        assert!(allow_webview_sql("DELETE FROM portfolios").is_err());
    }
}
