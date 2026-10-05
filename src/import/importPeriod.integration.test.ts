/// <reference types="node" />

import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Decimal from 'decimal.js'
import { afterEach, describe, expect, it } from 'vitest'
import type { DatabaseClient } from '../database/client'
import { createDatabaseClient } from '../database/client'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createPeriodAnalysisService } from '../engine/services/periodAnalysisService'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { ImportConflictError, ImportPeriodValidationError } from './importPeriodErrors'
import { createImportPeriodService } from './importPeriodService'
import { createNodeImportFiles } from './nodeImportFiles'
import { persistImportPlan } from './persistence/importPersistenceRepository'

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../parsers/balanz/fixtures/public',
)

const SOURCES = [
  ['consolidated-position-july2026-sanitized.txt', 'archivo-a.txt'],
  ['consolidated-position-august2026-sanitized.txt', 'archivo-b.txt'],
  ['august2026-sanitized.txt', 'archivo-c.txt'],
  ['monthly-fund-statement-august2026-sanitized.txt', 'archivo-d.txt'],
] as const

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ImportPeriodService contra SQLite', () => {
  it('persiste el período y el motor lee el mismo resultado desde la base', async () => {
    const world = await setup()
    const imported = await world.service.importPeriod({ portfolioId: world.portfolioId, files: world.files })

    expect(imported.outcome).toBe('imported')
    expect(await count(world.client, 'portfolios')).toBe(1)
    expect(await count(world.client, 'documents')).toBe(4)
    expect(await count(world.client, 'snapshots')).toBe(2)
    expect(await count(world.client, 'positions')).toBe(50)
    expect(await count(world.client, 'cash_balances')).toBe(6)
    expect(await count(world.client, 'transactions')).toBe(10)
    expect(await count(world.client, 'corporate_actions')).toBe(1)
    expect(await count(world.client, 'instruments')).toBe(25)
    expect(await count(world.client, 'position_field_sources')).toBe(150)
    expect(await count(world.client, 'reconciliation_runs')).toBe(1)
    expect(await count(world.client, 'snapshot_source_reconciliations')).toBe(2)

    const periods = await world.client.select<{ year: number; month: number; status: string }>(
      'SELECT year, month, status FROM periods ORDER BY year, month',
    )
    expect(periods).toEqual([
      { year: 2026, month: 7, status: 'PENDING' },
      { year: 2026, month: 8, status: 'COMPLETE' },
    ])

    const documents = await world.client.select<{ type: string; local_path: string }>(
      'SELECT type, local_path FROM documents ORDER BY type, local_path',
    )
    expect(documents.map((document) => document.type).sort()).toEqual([
      'CONSOLIDATED_POSITION',
      'CONSOLIDATED_POSITION',
      'MONTHLY_ACCOUNT',
      'MONTHLY_FUND_STATEMENT',
    ])
    for (const document of documents) {
      expect(document.local_path.startsWith('documents/')).toBe(true)
      expect(document.local_path.includes('..')).toBe(false)
      expect(/^[a-zA-Z]:/.test(document.local_path)).toBe(false)
      expect(document.local_path.endsWith('.txt')).toBe(true)
      const stored = new Uint8Array(await readFile(path.join(world.appData, ...document.local_path.split('/'))))
      const matchesOriginal = await originalBytes(world.files, stored)
      expect(matchesOriginal).toBe(true)
    }
    expect(documents.some((document) => document.local_path.includes('/2026/07/'))).toBe(true)
    expect(documents.some((document) => document.local_path.includes('/2026/08/'))).toBe(true)

    const totals = await world.client.select<{ date: string; total_value: string; type: string }>(
      `SELECT s.date, s.total_value, d.type
       FROM snapshots s JOIN documents d ON d.id = s.source_document_id
       ORDER BY s.date`,
    )
    expect(totals).toEqual([
      { date: '2026-07-31', total_value: '25954029', type: 'CONSOLIDATED_POSITION' },
      { date: '2026-08-31', total_value: '26383988', type: 'CONSOLIDATED_POSITION' },
    ])

    const funds = await world.client.select<{ date: string; ticker: string; quantity: string; unit_price: string; market_value: string }>(
      `SELECT s.date, i.ticker, p.quantity, p.unit_price, p.market_value
       FROM positions p
       JOIN instruments i ON i.id = p.instrument_id
       JOIN snapshots s ON s.id = p.snapshot_id
       WHERE i.ticker IN ('BCACCA', 'BRTA')
       ORDER BY i.ticker, s.date`,
    )
    expect(funds).toEqual([
      { date: '2026-07-31', ticker: 'BCACCA', quantity: '14860.792493', unit_price: '167.933481', market_value: '2495624.61' },
      { date: '2026-08-31', ticker: 'BCACCA', quantity: '14860.792493', unit_price: '153.944160', market_value: '2287732.22' },
      { date: '2026-07-31', ticker: 'BRTA', quantity: '3214.592773', unit_price: '746.673907', market_value: '2400252.55' },
      { date: '2026-08-31', ticker: 'BRTA', quantity: '3214.592773', unit_price: '742.458542', market_value: '2386701.86' },
    ])
    expect(await countWhere(world.client, "instruments WHERE name = 'BALANZ ACCIONES' OR name = 'BALANZ RETORNO TOTAL'")).toBe(0)
    expect(await countWhere(world.client, "instruments WHERE ticker = 'META'")).toBe(1)
    expect(await countWhere(world.client, "instruments WHERE ticker = 'BCACCA'")).toBe(1)

    const provenance = await world.client.select<{ date: string; ticker: string; type: string; as_of_date: string }>(
      `SELECT s.date, i.ticker, d.type, f.as_of_date
       FROM position_field_sources f
       JOIN positions p ON p.id = f.position_id
       JOIN instruments i ON i.id = p.instrument_id
       JOIN snapshots s ON s.id = p.snapshot_id
       JOIN documents d ON d.id = f.document_id
       WHERE f.field_name = 'market_value' AND i.ticker IN ('BCACCA', 'META')
       ORDER BY i.ticker, s.date`,
    )
    expect(provenance).toEqual([
      { date: '2026-07-31', ticker: 'BCACCA', type: 'MONTHLY_FUND_STATEMENT', as_of_date: '2026-07-31' },
      { date: '2026-08-31', ticker: 'BCACCA', type: 'MONTHLY_FUND_STATEMENT', as_of_date: '2026-08-31' },
      { date: '2026-07-31', ticker: 'META', type: 'CONSOLIDATED_POSITION', as_of_date: '2026-07-31' },
      { date: '2026-08-31', ticker: 'META', type: 'CONSOLIDATED_POSITION', as_of_date: '2026-08-31' },
    ])

    const cash = await world.client.select<{ date: string; currency: string; amount: string; fx_rate: string | null; value_in_base_currency: string | null }>(
      `SELECT s.date, c.currency, c.amount, c.fx_rate, c.value_in_base_currency
       FROM cash_balances c JOIN snapshots s ON s.id = c.snapshot_id
       ORDER BY s.date, c.currency`,
    )
    expect(cash).toEqual([
      { date: '2026-07-31', currency: 'ARS', amount: '17658.61', fx_rate: null, value_in_base_currency: '17658.61' },
      { date: '2026-07-31', currency: 'USD_CABLE', amount: '0.00', fx_rate: '1579.25', value_in_base_currency: '0' },
      { date: '2026-07-31', currency: 'USD_MEP', amount: '188.58', fx_rate: '1518.19', value_in_base_currency: '286300.2702' },
      { date: '2026-08-31', currency: 'ARS', amount: '267659.33', fx_rate: null, value_in_base_currency: '267659.33' },
      { date: '2026-08-31', currency: 'USD_CABLE', amount: '3.34', fx_rate: '1600.56', value_in_base_currency: '5345.8704' },
      { date: '2026-08-31', currency: 'USD_MEP', amount: '188.58', fx_rate: '1534.51', value_in_base_currency: '289377.8958' },
    ])

    const spy = await world.client.select<{ net_amount: string }>(
      `SELECT t.net_amount FROM transactions t
       JOIN instruments i ON i.id = t.instrument_id
       WHERE i.ticker = 'SPY' AND t.currency = 'ARS' AND t.type = 'DIVIDEND'`,
    )
    expect(spy).toEqual([{ net_amount: '-144.17' }])
    expect(await countWhere(world.client, "transactions WHERE type = 'BUY'")).toBe(0)
    expect(await countWhere(world.client, "transactions WHERE currency = 'USD_CABLE' AND fx_rate IS NOT NULL")).toBe(0)

    const action = await world.client.select<{ type: string; quantity_before: string; quantity_change: string; quantity_after: string }>(
      `SELECT a.type, a.quantity_before, a.quantity_change, a.quantity_after
       FROM corporate_actions a JOIN instruments i ON i.id = a.instrument_id
       WHERE i.ticker = 'YPFD'`,
    )
    expect(action).toEqual([
      { type: 'STOCK_DIVIDEND', quantity_before: '14', quantity_change: '126', quantity_after: '140' },
    ])

    const source = await world.client.select<{ date: string; raw_difference: string; enriched_difference: string }>(
      `SELECT s.date, r.raw_difference, r.enriched_difference
       FROM snapshot_source_reconciliations r JOIN snapshots s ON s.id = r.snapshot_id
       ORDER BY s.date`,
    )
    expect(source).toEqual([
      { date: '2026-07-31', raw_difference: '1.8802', enriched_difference: '1.0402' },
      { date: '2026-08-31', raw_difference: '0.0962', enriched_difference: '0.1762' },
    ])

    const analysis = await freshAnalysis(world.client, imported.periodId)
    expect(analysis.performance.expectedResult).toBe('179959.00')
    expect(analysis.performance.breakdown.valuationChange).toBe('171533.92')
    expect(fourPlaces(analysis.performance.breakdown.cashEconomicResult)).toBe('8424.2160')
    expect(fourPlaces(analysis.performance.explainedResult)).toBe('179958.1360')
    expect(fourPlaces(analysis.performance.unexplainedDifference)).toBe('0.8640')
    const ypfdId = await world.client.select<{ id: number | string }>('SELECT id FROM instruments WHERE ticker = ?', ['YPFD'])
    expect(analysis.performance.positionResults.find((position) => position.instrumentId === String(ypfdId[0]?.id))).toMatchObject({
      valuationChange: '-4900.00',
      status: 'CORPORATE_ACTION_EXPLAINED',
    })
    expect(analysis.performance.cash.status).toBe('EXPLAINED')
    expect(analysis.performance.cash.currencyAttributions.find((item) => item.currency === 'ARS')).toMatchObject({
      amountStatus: 'RECONCILED',
      attributionStatus: 'BASE_CURRENCY',
    })
    expect(analysis.performance.cash.currencyAttributions.find((item) => item.currency === 'USD_MEP')).toMatchObject({
      amountStatus: 'RECONCILED',
      attributionStatus: 'FX_ONLY',
    })
    expect(analysis.performance.cash.currencyAttributions.find((item) => item.currency === 'USD_CABLE')).toMatchObject({
      amountStatus: 'RECONCILED',
      attributionStatus: 'MISSING_TRANSACTION_FX',
    })

    const run = await world.client.select<{ expected_result: string; explained_result: string; difference: string; status: string; engine_version: string }>(
      'SELECT expected_result, explained_result, difference, status, engine_version FROM reconciliation_runs',
    )
    expect(fourPlaces(run[0]?.expected_result)).toBe('179959.0000')
    expect(fourPlaces(run[0]?.explained_result)).toBe('179958.1360')
    expect(fourPlaces(run[0]?.difference)).toBe('0.8640')
    expect(run[0]?.status).toBe('WARNING')
    expect(run[0]?.engine_version).toBe('1')

    const versions = await world.client.select<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')
    expect(versions.map((row) => row.version)).toEqual(['001', '002'])

    for (const file of world.files) {
      expect(await readFile(file.originalPath)).toBeTruthy()
    }
    world.close()
  })

  it('importar el mismo set otra vez no duplica filas', async () => {
    const world = await setup()
    await world.service.importPeriod({ portfolioId: world.portfolioId, files: world.files })
    const again = await world.service.importPeriod({ portfolioId: world.portfolioId, files: world.files })

    expect(again.outcome).toBe('existing')
    expect(await count(world.client, 'documents')).toBe(4)
    expect(await count(world.client, 'periods')).toBe(2)
    expect(await count(world.client, 'snapshots')).toBe(2)
    expect(await count(world.client, 'positions')).toBe(50)
    expect(await count(world.client, 'transactions')).toBe(10)
    expect(await count(world.client, 'corporate_actions')).toBe(1)
    expect(await count(world.client, 'reconciliation_runs')).toBe(1)
    expect(fourPlaces(again.analysis?.performance.unexplainedDifference)).toBe('0.8640')
    world.close()
  })

  it('reutiliza el snapshot de apertura si el archivo ya no viene en el set', async () => {
    const world = await setup()
    await world.service.importPeriod({ portfolioId: world.portfolioId, files: world.files })
    const withoutOpening = world.files.filter((file) => file.originalFileName !== 'archivo-a.txt')
    const again = await world.service.importPeriod({ portfolioId: world.portfolioId, files: withoutOpening })

    expect(again.outcome).toBe('existing')
    expect(await count(world.client, 'snapshots')).toBe(2)
    expect(await count(world.client, 'documents')).toBe(4)
    world.close()
  })

  it('un set incompatible no escribe nada', async () => {
    const world = await setup()
    const fund = world.files[3]
    if (!fund) throw new Error('falta el resumen de fondos')
    const text = await readFile(fund.originalPath, 'utf8')
    await writeFile(fund.originalPath, text.replace('31/08/2026', '30/09/2026'))

    await expect(world.service.importPeriod({ portfolioId: world.portfolioId, files: world.files })).rejects.toBeInstanceOf(
      ImportPeriodValidationError,
    )
    expect(await count(world.client, 'documents')).toBe(0)
    expect(await count(world.client, 'snapshots')).toBe(0)
    expect(await count(world.client, 'periods')).toBe(0)
    expect(await filesUnder(path.join(world.appData, 'documents'))).toEqual([])
    world.close()
  })

  it('otro hash para la misma fecha de snapshot es un conflicto', async () => {
    const world = await setup()
    await world.service.importPeriod({ portfolioId: world.portfolioId, files: world.files })
    const closing = world.files[1]
    if (!closing) throw new Error('falta la posición de cierre')
    const other = path.join(world.inputDir, 'otra-posicion.txt')
    await writeFile(other, `${await readFile(closing.originalPath, 'utf8')}\n`)
    const files = world.files.map((file) => (file.originalPath === closing.originalPath ? { originalPath: other, originalFileName: 'otra-posicion.txt' } : file))

    await expect(world.service.importPeriod({ portfolioId: world.portfolioId, files })).rejects.toBeInstanceOf(ImportConflictError)
    expect(await count(world.client, 'documents')).toBe(4)
    expect(await count(world.client, 'snapshots')).toBe(2)
    world.close()
  })

  it('si la transacción falla, no quedan filas ni archivos publicados', async () => {
    const world = await setup({
      beforePersist() {
        throw new Error('fallo inyectado')
      },
    })
    await expect(world.service.importPeriod({ portfolioId: world.portfolioId, files: world.files })).rejects.toThrow(
      'fallo inyectado',
    )
    expect(await count(world.client, 'documents')).toBe(0)
    expect(await count(world.client, 'periods')).toBe(0)
    expect(await filesUnder(path.join(world.appData, 'documents'))).toEqual([])
    expect(await readFile(world.files[0]?.originalPath ?? '')).toBeTruthy()
    world.close()
  })

  it('un insert duplicado revierte toda la transacción', async () => {
    const world = await setup()
    const snapshot = {
      periodKey: 'closing',
      documentKey: 'closing-position',
      date: '2026-08-31',
      totalValue: '1',
      currency: 'ARS' as const,
      existingId: null,
      positions: [],
      cash: [],
      rawDifference: '0',
      enrichedDifference: '0',
    }
    await expect(
      persistImportPlan(world.client, {
        portfolioId: world.portfolioId,
        completedAt: '2026-10-05T00:00:00.000Z',
        periods: [{ key: 'closing', existingId: null, year: 2026, month: 8, completes: true }],
        documents: [
          {
            key: 'closing-position',
            existingId: null,
            periodKey: 'closing',
            type: 'CONSOLIDATED_POSITION',
            originalFilename: 'a.txt',
            localPath: 'documents/2026/08/abc-consolidated-position.txt',
            sha256: 'a'.repeat(64),
            parserVersion: '1',
          },
        ],
        instruments: [],
        snapshots: [
          { ...snapshot, key: 'closing' },
          { ...snapshot, key: 'opening' },
        ],
        transactions: [],
        corporateActions: [],
      }),
    ).rejects.toThrow()
    expect(await count(world.client, 'periods')).toBe(0)
    expect(await count(world.client, 'documents')).toBe(0)
    expect(await count(world.client, 'snapshots')).toBe(0)
    world.close()
  })

  it('rechaza el mismo archivo elegido dos veces y no escribe', async () => {
    const world = await setup()
    const closing = world.files[1]
    if (!closing) throw new Error('falta la posición de cierre')
    const copy = path.join(world.inputDir, 'copia-cierre.txt')
    await copyFile(closing.originalPath, copy)
    await expect(
      world.service.importPeriod({
        portfolioId: world.portfolioId,
        files: [...world.files, { originalPath: copy, originalFileName: 'copia-cierre.txt' }],
      }),
    ).rejects.toThrow('Seleccionaste dos veces el mismo archivo.')
    expect(await count(world.client, 'documents')).toBe(0)
    world.close()
  })

  it('si el análisis no se guarda, el período queda importado', async () => {
    const world = await setup()
    world.service = createImportPeriodService({
      db: failReconciliationInsert(world.client),
      appDataDir: world.appData,
      files: createNodeImportFiles(),
      now: () => '2026-10-05T18:00:00.000Z',
    })
    const imported = await world.service.importPeriod({ portfolioId: world.portfolioId, files: world.files })
    expect(imported.analysis).toBeNull()
    const periods = await world.client.select<{ status: string }>('SELECT status FROM periods WHERE month = 8')
    expect(periods[0]?.status).toBe('COMPLETE')
    expect(await count(world.client, 'documents')).toBe(4)
    expect(await count(world.client, 'reconciliation_runs')).toBe(0)
    world.close()
  })
})

async function setup(options?: { beforePersist?: () => void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'cartera-import-'))
  roots.push(root)
  const appData = path.join(root, 'app-data')
  const inputDir = path.join(root, 'entrada')
  await mkdir(appData, { recursive: true })
  await mkdir(inputDir, { recursive: true })
  const database = openMemoryDatabase()
  const portfolio = await createPortfolioRepository(database.client).create({
    name: 'Mi cartera',
    broker: 'BALANZ',
    baseCurrency: 'ARS',
  })
  const files = []
  for (const [source, name] of SOURCES) {
    const originalPath = path.join(inputDir, name)
    await copyFile(path.join(FIXTURES, source), originalPath)
    files.push({ originalPath, originalFileName: name })
  }
  return {
    client: database.client,
    close: database.close,
    appData,
    inputDir,
    portfolioId: portfolio.id,
    files,
    service: createImportPeriodService({
      db: database.client,
      appDataDir: appData,
      files: createNodeImportFiles(),
      now: () => '2026-10-05T18:00:00.000Z',
      beforePersist: options?.beforePersist,
    }),
  }
}

async function freshAnalysis(client: DatabaseClient, periodId: string) {
  const periods = createPeriodRepository(client)
  const snapshots = createSnapshotRepository(client)
  const transactions = createTransactionRepository(client)
  const corporateActions = createCorporateActionRepository(client)
  return createPerformanceAnalysisService({
    analysis: createPeriodAnalysisService({ periods, snapshots, transactions }),
    periods,
    snapshots,
    transactions,
    corporateActions,
  }).analyzePeriod(periodId)
}

async function count(client: DatabaseClient, table: string): Promise<number> {
  return countWhere(client, table)
}

async function countWhere(client: DatabaseClient, from: string): Promise<number> {
  const rows = await client.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${from}`)
  return Number(rows[0]?.n ?? 0)
}

function fourPlaces(value: string | null | undefined): string {
  return new Decimal(value ?? '0').toFixed(4)
}

async function originalBytes(
  files: { originalPath: string }[],
  stored: Uint8Array,
): Promise<boolean> {
  for (const file of files) {
    const original = new Uint8Array(await readFile(file.originalPath))
    if (original.byteLength === stored.byteLength && original.every((byte, index) => byte === stored[index])) {
      return true
    }
  }
  return false
}

function failReconciliationInsert(client: DatabaseClient): DatabaseClient {
  return createDatabaseClient({
    select(sql, params) {
      return client.select(sql, params)
    },
    async execute(sql, params) {
      if (sql.includes('INSERT INTO reconciliation_runs')) {
        throw new Error('run failed')
      }
      return client.execute(sql, params)
    },
    transaction(statements) {
      return client.transaction(statements)
    },
  })
}

async function filesUnder(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesUnder(child)))
    else files.push(child)
  }
  return files
}
