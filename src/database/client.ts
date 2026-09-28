import type { EntityId } from '../domain/common'
import { RepositoryError } from './errors'

export type SqlParam = string | number | null

/** Sustituye este parámetro por el last_insert_rowid de una sentencia anterior. */
export interface LastInsertRef {
  lastInsertIdOf: number
}

export type TransactionParam = SqlParam | LastInsertRef

export interface TransactionStatement {
  sql: string
  params?: TransactionParam[]
}

export interface TransactionResult {
  lastInsertIds: number[]
}

export interface ExecuteResult {
  rowsAffected: number
  lastInsertId: number
}

export interface DatabaseClient {
  select<T>(sql: string, params?: SqlParam[]): Promise<T[]>
  selectOne<T>(sql: string, params?: SqlParam[]): Promise<T | null>
  execute(sql: string, params?: SqlParam[]): Promise<ExecuteResult>
  /**
   * Ejecuta las sentencias en una sola transacción SQLite.
   * La implementación tiene que usar la misma conexión de principio a fin.
   */
  transaction(statements: TransactionStatement[]): Promise<TransactionResult>
}

interface SqlExecutor {
  select<T>(sql: string, params?: SqlParam[]): Promise<T[]>
  execute(sql: string, params?: SqlParam[]): Promise<ExecuteResult>
  transaction(statements: TransactionStatement[]): Promise<TransactionResult>
}

export function createDatabaseClient(executor: SqlExecutor): DatabaseClient {
  return {
    select<T>(sql: string, params?: SqlParam[]) {
      return executor.select<T>(sql, params)
    },
    execute(sql: string, params?: SqlParam[]) {
      return executor.execute(sql, params)
    },
    async selectOne<T>(sql: string, params?: SqlParam[]) {
      const rows = await executor.select<T>(sql, params)
      const row = rows[0]
      if (row === undefined) return null
      return row
    },
    transaction(statements) {
      return executor.transaction(statements)
    },
  }
}

export function insertedId(result: ExecuteResult, context: string): EntityId {
  if (!Number.isSafeInteger(result.lastInsertId) || result.lastInsertId <= 0) {
    throw new RepositoryError(`${context}: SQLite no devolvió un id válido`)
  }
  return String(result.lastInsertId)
}
