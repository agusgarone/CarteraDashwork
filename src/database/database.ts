import {
  createDatabaseClient,
  type DatabaseClient,
  type SqlParam,
  type TransactionResult,
  type TransactionStatement,
} from './client'

/**
 * Una sola base, `cartera.db`, en el directorio de configuración de la app.
 *
 * sqlx abre el pool con `foreign_keys(true)`. Ese pragma corre dentro de
 * `connect()`, cada vez que el pool crea una conexión. No depende del
 * PRAGMA del archivo de schema ni de una llamada suelta desde TypeScript.
 *
 * `transaction()` manda todas las sentencias en un solo comando. Rust las
 * ejecuta con `pool.begin()`, que reserva una conexión hasta el COMMIT o
 * el ROLLBACK.
 */
interface ExecuteResponse {
  rowsAffected: number
  lastInsertId: number
}

let databasePromise: Promise<DatabaseClient> | null = null
let appClient: DatabaseClient | null = null

export function getDatabase(): Promise<DatabaseClient> {
  databasePromise ??= openDatabase().catch((error: unknown) => {
    databasePromise = null
    throw error
  })
  return databasePromise
}

async function openDatabase(): Promise<DatabaseClient> {
  const { invoke } = await import('@tauri-apps/api/core')

  return createDatabaseClient({
    select<T>(sql: string, params?: SqlParam[]) {
      return invoke<T[]>('db_select', { sql, params: params ?? [] })
    },
    async execute(sql: string, params?: SqlParam[]) {
      const result = await invoke<ExecuteResponse>('db_execute', {
        sql,
        params: params ?? [],
      })
      return {
        rowsAffected: result.rowsAffected,
        lastInsertId: result.lastInsertId,
      }
    },
    transaction(statements: TransactionStatement[]) {
      return invoke<TransactionResult>('db_transaction', { statements })
    },
  })
}

/** Cliente perezoso: no abre SQLite hasta la primera consulta. */
export function getAppDatabaseClient(): DatabaseClient {
  appClient ??= createDatabaseClient({
    async select<T>(sql: string, params?: SqlParam[]) {
      const database = await getDatabase()
      return database.select<T>(sql, params)
    },
    async execute(sql: string, params?: SqlParam[]) {
      const database = await getDatabase()
      return database.execute(sql, params)
    },
    async transaction(statements: TransactionStatement[]): Promise<TransactionResult> {
      const database = await getDatabase()
      return database.transaction(statements)
    },
  })
  return appClient
}
