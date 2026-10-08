/// <reference types="node" />

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = [
  ['001', '001_initial_schema.sql'],
  ['002', '002_import_provenance.sql'],
  ['003', '003_cash_movement_legs.sql'],
  ['004', '004_trade_cost_components.sql'],
] as const

/**
 * Aplica el historial de migraciones.
 * 001 queda fuera de una transacción porque incluye PRAGMA foreign_keys.
 * Las siguientes se registran solo si terminan.
 */
export function applySqlMigrations(sqlite: DatabaseSync): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const applied = sqlite.prepare('SELECT version FROM schema_migrations WHERE version = ?')
  const record = sqlite.prepare('INSERT INTO schema_migrations (version) VALUES (?)')

  for (const [version, filename] of MIGRATIONS) {
    if (applied.get(version)) continue
    const sql = readFileSync(path.join(root, 'src-tauri/migrations', filename), 'utf8')
    if (version === '001') {
      sqlite.exec(sql)
      record.run(version)
      continue
    }
    sqlite.exec('BEGIN')
    try {
      sqlite.exec(sql)
      record.run(version)
      sqlite.exec('COMMIT')
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  }
}
