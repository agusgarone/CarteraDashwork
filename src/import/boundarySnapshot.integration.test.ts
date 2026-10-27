/// <reference types="node" />

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { importSelectedDocuments } from '../application/importPeriodApplication'
import { describeImportFailure } from '../application/importFailure'
import type { DatabaseClient } from '../database/client'
import { openFileDatabase } from '../database/sqliteMemory'
import { ImportConflictError } from './importPeriodErrors'
import { extractPdfText } from '../parsers/text/extractPdfText'
import { detectBalanzDocument } from './detectDocument'
import { createNodeImportFiles } from './nodeImportFiles'

const PRIVATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../parsers/balanz/fixtures/private')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('el snapshot de frontera se comparte entre dos meses', () => {
  it('importa julio después de agosto y reutiliza el 31/07', async (context) => {
    const files = await boundaryFiles()
    if (!files) {
      context.skip('Faltan los PDF privados de junio, julio y agosto.')
      return
    }

    const database = await openImportDatabase()
    try {
      await importSelectedDocuments({
        db: database.client,
        appDataDir: database.appData,
        files: createNodeImportFiles(),
        paths: [files.julyPosition, files.augustPosition, files.augustAccount, files.augustFund],
      })
      const augustBefore = await augustRows(database.client)

      const july = await importSelectedDocuments({
        db: database.client,
        appDataDir: database.appData,
        files: createNodeImportFiles(),
        paths: [files.junePosition, files.julyPosition, files.julyAccount, files.julyFund],
      })

      expect(july.outcome).toBe('created')
      expect(july.period).toMatchObject({ year: 2026, month: 7, status: 'COMPLETE' })
      expect(await augustRows(database.client)).toEqual(augustBefore)
      expect(await snapshotDates(database.client)).toEqual(['2026-06-30', '2026-07-31', '2026-08-31'])
      expect(await countWhere(database.client, "documents WHERE original_filename LIKE '%20260731%'")).toBe(1)
      expect(await count(database.client, 'snapshots')).toBe(3)
      expect(await count(database.client, 'documents')).toBe(7)
      await expectBoundaries(database.client)
      const beforeRepeat = {
        fingerprint: await fingerprint(database.client),
        positions: await count(database.client, 'positions'),
        cash: await count(database.client, 'cash_balances'),
        transactions: await count(database.client, 'transactions'),
      }

      const again = await importSelectedDocuments({
        db: database.client,
        appDataDir: database.appData,
        files: createNodeImportFiles(),
        paths: [files.junePosition, files.julyPosition, files.julyAccount, files.julyFund],
      })
      expect(again.outcome).toBe('existing')
      expect(await count(database.client, 'snapshots')).toBe(3)
      expect(await count(database.client, 'documents')).toBe(7)
      expect(await count(database.client, 'positions')).toBe(beforeRepeat.positions)
      expect(await count(database.client, 'cash_balances')).toBe(beforeRepeat.cash)
      expect(await count(database.client, 'transactions')).toBe(beforeRepeat.transactions)
      expect(await fingerprint(database.client)).toEqual(beforeRepeat.fingerprint)
    } finally {
      database.close()
    }
  }, 180_000)

  it('deja la misma base si julio se importa antes que agosto', async (context) => {
    const files = await boundaryFiles()
    if (!files) {
      context.skip('Faltan los PDF privados de junio, julio y agosto.')
      return
    }

    const augustFirst = await openImportDatabase()
    const julyFirst = await openImportDatabase()
    try {
      await importSelectedDocuments({
        db: augustFirst.client,
        appDataDir: augustFirst.appData,
        files: createNodeImportFiles(),
        paths: [files.julyPosition, files.augustPosition, files.augustAccount, files.augustFund],
      })
      await importSelectedDocuments({
        db: augustFirst.client,
        appDataDir: augustFirst.appData,
        files: createNodeImportFiles(),
        paths: [files.junePosition, files.julyPosition, files.julyAccount, files.julyFund],
      })

      await importSelectedDocuments({
        db: julyFirst.client,
        appDataDir: julyFirst.appData,
        files: createNodeImportFiles(),
        paths: [files.junePosition, files.julyPosition, files.julyAccount, files.julyFund],
      })
      await importSelectedDocuments({
        db: julyFirst.client,
        appDataDir: julyFirst.appData,
        files: createNodeImportFiles(),
        paths: [files.julyPosition, files.augustPosition, files.augustAccount, files.augustFund],
      })

      expect(await fingerprint(julyFirst.client)).toEqual(await fingerprint(augustFirst.client))
      expect(await snapshotDates(julyFirst.client)).toEqual(['2026-06-30', '2026-07-31', '2026-08-31'])
      await expectBoundaries(julyFirst.client)
    } finally {
      augustFirst.close()
      julyFirst.close()
    }
  }, 180_000)

  it('un archivo distinto para la misma fecha sigue siendo conflicto', async () => {
    const failure = describeImportFailure(new ImportConflictError('Ya hay otro documento para el snapshot 2026-07-31.'))
    expect(failure.headline).toBe('Mismo período/fecha con información diferente')
  })
})

async function openImportDatabase() {
  const root = await mkdtemp(path.join(tmpdir(), 'boundary-import-'))
  roots.push(root)
  const database = openFileDatabase(path.join(root, 'cartera.db'))
  return {
    client: database.client,
    appData: path.join(root, 'data'),
    close: () => database.close(),
  }
}

async function augustRows(db: DatabaseClient) {
  return db.select<{ id: number; date: string; total_value: string; source_document_id: number | null; transactions: number }>(
    `SELECT snapshots.id, snapshots.date, snapshots.total_value, snapshots.source_document_id,
            (SELECT COUNT(*) FROM transactions JOIN periods ON periods.id = transactions.period_id
             WHERE periods.year = 2026 AND periods.month = 8) AS transactions
     FROM snapshots
     WHERE snapshots.date = '2026-08-31'`,
  )
}

async function snapshotDates(db: DatabaseClient): Promise<string[]> {
  const rows = await db.select<{ date: string }>('SELECT date FROM snapshots ORDER BY date')
  return rows.map((row) => row.date)
}

async function expectBoundaries(db: DatabaseClient) {
  const rows = await db.select<{ date: string; total_value: string; year: number; month: number }>(
    `SELECT snapshots.date, snapshots.total_value, periods.year, periods.month
     FROM snapshots
     JOIN periods ON periods.id = snapshots.period_id
     ORDER BY snapshots.date`,
  )
  expect(rows).toEqual([
    { date: '2026-06-30', total_value: '23007361', year: 2026, month: 6 },
    { date: '2026-07-31', total_value: '25954029', year: 2026, month: 7 },
    { date: '2026-08-31', total_value: '26383988', year: 2026, month: 8 },
  ])
  const shared = await db.select<{ copies: number }>(
    `SELECT COUNT(*) AS copies FROM snapshots WHERE date = '2026-07-31'`,
  )
  expect(shared[0]?.copies).toBe(1)
}

async function fingerprint(db: DatabaseClient) {
  return {
    snapshots: await db.select('SELECT date, total_value FROM snapshots ORDER BY date'),
    documents: await db.select('SELECT type, sha256 FROM documents ORDER BY sha256'),
    periods: await db.select('SELECT year, month, status FROM periods ORDER BY year, month'),
    transactions: await db.select(
      `SELECT periods.year AS year, periods.month AS month, COUNT(*) AS count
       FROM transactions
       JOIN periods ON periods.id = transactions.period_id
       GROUP BY periods.year, periods.month
       ORDER BY periods.year, periods.month`,
    ),
    positions: await db.select(
      `SELECT snapshots.date AS date, COUNT(*) AS count
       FROM positions
       JOIN snapshots ON snapshots.id = positions.snapshot_id
       GROUP BY snapshots.date
       ORDER BY snapshots.date`,
    ),
    cash: await db.select(
      `SELECT snapshots.date AS date, cash_balances.currency AS currency, cash_balances.amount AS amount
       FROM cash_balances
       JOIN snapshots ON snapshots.id = cash_balances.snapshot_id
       ORDER BY snapshots.date, cash_balances.currency`,
    ),
  }
}

async function count(db: DatabaseClient, table: string): Promise<number> {
  const rows = await db.select<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
  return rows[0]?.count ?? 0
}

async function countWhere(db: DatabaseClient, where: string): Promise<number> {
  const rows = await db.select<{ count: number }>(`SELECT COUNT(*) AS count FROM ${where}`)
  return rows[0]?.count ?? 0
}

async function boundaryFiles() {
  if (!existsSync(PRIVATE)) return null
  const { readdir } = await import('node:fs/promises')
  const names = (await readdir(PRIVATE)).filter((name) => name.toLowerCase().endsWith('.pdf'))
  const files = []
  for (const name of names) {
    const filePath = path.join(PRIVATE, name)
    const text = await extractPdfText(new Uint8Array(await readFile(filePath)))
    files.push({ path: filePath, kind: detectBalanzDocument(text), text })
  }
  const junePosition = files.find((file) => file.kind === 'CONSOLIDATED_POSITION' && /30\/06\/2026/.test(file.text))
  const julyPosition = files.find((file) => file.kind === 'CONSOLIDATED_POSITION' && /31\/07\/2026/.test(file.text))
  const augustPosition = files.find((file) => file.kind === 'CONSOLIDATED_POSITION' && /31\/08\/2026/.test(file.text))
  const julyAccount = files.find(
    (file) => file.kind === 'MONTHLY_ACCOUNT' && /1\/7\/2026/.test(file.text) && /31\/7\/2026/.test(file.text),
  )
  const augustAccount = files.find(
    (file) => file.kind === 'MONTHLY_ACCOUNT' && /1\/8\/2026/.test(file.text) && /31\/8\/2026/.test(file.text),
  )
  const julyFund = files.find(
    (file) => file.kind === 'MONTHLY_FUND_STATEMENT' && /informe del total de su inversi[oó]n al:?\s*31\/0?7\/2026/i.test(file.text),
  )
  const augustFund = files.find(
    (file) => file.kind === 'MONTHLY_FUND_STATEMENT' && /informe del total de su inversi[oó]n al:?\s*31\/0?8\/2026/i.test(file.text),
  )
  if (!junePosition || !julyPosition || !augustPosition || !julyAccount || !augustAccount || !julyFund || !augustFund) {
    return null
  }
  return {
    junePosition: junePosition.path,
    julyPosition: julyPosition.path,
    augustPosition: augustPosition.path,
    julyAccount: julyAccount.path,
    augustAccount: augustAccount.path,
    julyFund: julyFund.path,
    augustFund: augustFund.path,
  }
}
