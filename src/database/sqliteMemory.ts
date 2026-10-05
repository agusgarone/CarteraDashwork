/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite'
import {
  createDatabaseClient,
  type DatabaseClient,
  type SqlParam,
  type TransactionParam,
  type TransactionStatement,
} from './client'
import { applySqlMigrations } from './applyMigrations'

export interface NodeDatabase {
  client: DatabaseClient
  /**
   * Copia consistente mientras esta conexión sigue abierta.
   * `VACUUM INTO` escribe otro archivo. No copia el archivo en uso.
   */
  snapshot(destination: string): void
  close: () => void
}

/**
 * SQLite en memoria con el schema de la aplicación.
 * Sirve para tests. No abre cartera.db.
 */
export function openMemoryDatabase(): NodeDatabase {
  return openNodeDatabase(new DatabaseSync(':memory:'))
}

/** Abre un archivo SQLite ya creado o uno nuevo y aplica las migraciones que falten. */
export function openFileDatabase(filePath: string): NodeDatabase {
  return openNodeDatabase(new DatabaseSync(filePath))
}

function openNodeDatabase(sqlite: DatabaseSync): NodeDatabase {
  applySqlMigrations(sqlite)

  function run(sql: string, params: SqlParam[]) {
    const info = sqlite.prepare(sql.replaceAll(/\$\d+/g, '?')).run(...params)
    const rawId = info.lastInsertRowid
    const lastInsertId = typeof rawId === 'bigint' ? Number(rawId) : rawId
    return { rowsAffected: Number(info.changes), lastInsertId }
  }

  function resolveParam(param: TransactionParam, ids: number[]): SqlParam {
    if (typeof param === 'object' && param !== null && 'lastInsertIdOf' in param) {
      const id = ids[param.lastInsertIdOf]
      if (id === undefined) {
        throw new Error(`lastInsertIdOf ${param.lastInsertIdOf} no está disponible`)
      }
      return id
    }
    return param
  }

  const client = createDatabaseClient({
    select<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      const statement = sqlite.prepare(sql.replaceAll(/\$\d+/g, '?'))
      const rows = statement.all(...params)
      return Promise.resolve(rows as T[])
    },
    execute(sql: string, params: SqlParam[] = []) {
      return Promise.resolve(run(sql, params))
    },
    transaction(statements: TransactionStatement[]) {
      sqlite.exec('BEGIN')
      const ids: number[] = []
      try {
        for (const statement of statements) {
          const params = (statement.params ?? []).map((param) => resolveParam(param, ids))
          ids.push(run(statement.sql, params).lastInsertId)
        }
        sqlite.exec('COMMIT')
        return Promise.resolve({ lastInsertIds: ids })
      } catch (error) {
        sqlite.exec('ROLLBACK')
        return Promise.reject(error)
      }
    },
  })

  return {
    client,
    snapshot(destination: string) {
      const sqlPath = destination.replaceAll('\\', '/').replaceAll("'", "''")
      sqlite.exec(`VACUUM INTO '${sqlPath}'`)
    },
    close() {
      sqlite.close()
    },
  }
}
