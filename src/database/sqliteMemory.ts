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

/**
 * SQLite en memoria con el schema de la aplicación.
 * Sirve para tests. No abre cartera.db.
 */
export function openMemoryDatabase(): { client: DatabaseClient; close: () => void } {
  const sqlite = new DatabaseSync(':memory:')
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
    close() {
      sqlite.close()
    },
  }
}
