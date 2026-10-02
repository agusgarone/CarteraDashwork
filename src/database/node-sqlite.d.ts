declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }

  export interface StatementSync {
    all(...params: ReadonlyArray<string | number | null>): unknown[]
    run(...params: ReadonlyArray<string | number | null>): {
      changes: number | bigint
      lastInsertRowid: number | bigint
    }
  }
}
