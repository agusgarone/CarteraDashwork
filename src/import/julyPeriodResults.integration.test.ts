/// <reference types="node" />

import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { utils, write } from 'xlsx'
import { importSelectedDocuments } from '../application/importPeriodApplication'
import { openFileDatabase, openMemoryDatabase } from '../database/sqliteMemory'
import { formatExact, parseDecimal } from '../engine/money'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createPeriodAnalysisService } from '../engine/services/periodAnalysisService'
import { parseBalanzPeriodResults } from '../parsers/balanz/periodResults'
import { extractPdfText } from '../parsers/text/extractPdfText'
import { createCashMovementLegRepository } from '../repositories/cashMovementLegRepository'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionFxRepository } from '../repositories/transactionFxRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { detectBalanzDocument } from './detectDocument'
import { ImportPeriodValidationError } from './importPeriodErrors'
import { createImportPeriodService } from './importPeriodService'
import { createNodeImportFiles } from './nodeImportFiles'

const PRIVATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../parsers/balanz/fixtures/private')
const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../parsers/balanz/fixtures/public')
const REAL_RESULTS = path.join(PRIVATE, 'ResultadosDelPeriodo_202607.xlsx')
const AUGUST_SOURCES = [
  ['consolidated-position-july2026-sanitized.txt', 'apertura.txt'],
  ['consolidated-position-august2026-sanitized.txt', 'cierre.txt'],
  ['august2026-sanitized.txt', 'cuenta.txt'],
  ['monthly-fund-statement-august2026-sanitized.txt', 'fondos.txt'],
] as const
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Excel opcional de Resultados del período', () => {
  it('no cambia el resultado de agosto y rechaza un Excel de otro período', async () => {
    const first = await augustWorld()
    const imported = await first.service.importPeriod({ portfolioId: first.portfolioId, files: first.files })
    expect(imported.analysis?.base.investmentResult).toBe('179959.00')
    expect(await count(first.client, 'transactions')).toBe(10)
    expect(await count(first.client, 'transaction_fx_enrichments')).toBe(0)
    first.close()

    const rejected = await augustWorld()
    await rejected.service.importPeriod({ portfolioId: rejected.portfolioId, files: rejected.files })
    const wrong = path.join(rejected.inputDir, 'otro-periodo.xlsx')
    await writeFile(wrong, Buffer.from(resultsWorkbook('2026-06-30', '2026-07-31')))
    await expect(rejected.service.importPeriod({
      portfolioId: rejected.portfolioId,
      files: [...rejected.files, { originalPath: wrong, originalFileName: 'otro-periodo.xlsx' }],
    })).rejects.toThrow(ImportPeriodValidationError)
    expect(await count(rejected.client, 'transactions')).toBe(10)
    expect(await count(rejected.client, 'documents')).toBe(4)
    rejected.close()

    const enriched = await augustWorld()
    const excel = path.join(enriched.inputDir, 'resultados.xlsx')
    await writeFile(excel, Buffer.from(resultsWorkbook('2026-07-31', '2026-08-31')))
    const withExcel = await enriched.service.importPeriod({
      portfolioId: enriched.portfolioId,
      files: [...enriched.files, { originalPath: excel, originalFileName: 'resultados.xlsx' }],
    })
    expect(withExcel.analysis?.base.investmentResult).toBe('179959.00')
    expect(await count(enriched.client, 'documents')).toBe(5)
    expect(await count(enriched.client, 'transactions')).toBe(10)
    const again = await enriched.service.importPeriod({
      portfolioId: enriched.portfolioId,
      files: [...enriched.files, { originalPath: excel, originalFileName: 'resultados.xlsx' }],
    })
    expect(again.outcome).toBe('existing')
    expect(await count(enriched.client, 'documents')).toBe(5)
    expect(await count(enriched.client, 'transactions')).toBe(10)
    enriched.close()
  })

  it('importa julio sin Excel y después agrega el enriquecimiento sin duplicar operaciones', async (context) => {
    const files = await julyFiles()
    if (!files || !existsSync(REAL_RESULTS)) {
      context.skip('Los documentos privados de julio no están en esta máquina.')
      return
    }
    const root = await mkdtemp(path.join(tmpdir(), 'july-results-'))
    roots.push(root)
    const database = openFileDatabase(path.join(root, 'cartera.db'))
    try {
      const without = await importSelectedDocuments({
        db: database.client,
        appDataDir: path.join(root, 'data'),
        files: createNodeImportFiles(),
        paths: [files.opening, files.closing, files.account, files.fund],
      })
      const before = await analyze(database.client, without.period.id)
      const instruments = await createInstrumentRepository(database.client).getAll()
      const tickerOf = new Map(instruments.map((instrument) => [instrument.id, instrument.ticker]))
      const pending = before.performance.pendingAttribution?.positions.map((item) => tickerOf.get(item.instrumentId)).sort()
      expect(pending).toEqual(['PAMP', 'YPFD'])
      expect(before.performance.partialExplainedResult).toBe('759606.24')
      expect(await count(database.client, 'transactions')).toBeGreaterThan(0)
      const transactionsBefore = await count(database.client, 'transactions')

      const withExcel = await importSelectedDocuments({
        db: database.client,
        appDataDir: path.join(root, 'data'),
        files: createNodeImportFiles(),
        paths: [files.opening, files.closing, files.account, files.fund, REAL_RESULTS],
      })
      expect(withExcel.outcome).toBe('created')
      expect(withExcel.analysis?.expectedResult).toBe('1146668.00')
      expect(withExcel.periodReturnLabel).toBe('+4,64%')
      expect(withExcel.analysis?.explainedResult).toBeNull()
      expect(await count(database.client, 'transactions')).toBe(transactionsBefore)
      expect(withExcel.documents.some((document) => document.type === 'PERIOD_RESULTS')).toBe(true)

      const after = await analyze(database.client, withExcel.period.id)
      await expectJulyEnrichment(database.client, after)
      const enrichments = await count(database.client, 'transaction_fx_enrichments')
      expect(enrichments).toBeGreaterThan(0)

      const repeated = await importSelectedDocuments({
        db: database.client,
        appDataDir: path.join(root, 'data'),
        files: createNodeImportFiles(),
        paths: [files.opening, files.closing, files.account, files.fund, REAL_RESULTS],
      })
      expect(repeated.outcome).toBe('existing')
      expect(await count(database.client, 'transactions')).toBe(transactionsBefore)
      expect(await count(database.client, 'transaction_fx_enrichments')).toBe(enrichments)
    } finally {
      database.close()
    }
  }, 120_000)

  it('acepta el Excel en la primera importación de julio', async (context) => {
    const files = await julyFiles()
    if (!files || !existsSync(REAL_RESULTS)) {
      context.skip('Los documentos privados de julio no están en esta máquina.')
      return
    }
    const parsed = parseBalanzPeriodResults(new Uint8Array(await readFile(REAL_RESULTS)))
    expect(parsed).toMatchObject({
      openingDate: '2026-06-30',
      closingDate: '2026-07-31',
      initialLotCount: 69,
      realizedCount: 80,
      finalLotCount: 69,
    })
    expect(parsed.initialLotCount).toBeGreaterThan(0)
    expect(parsed.realizedCount).toBeGreaterThan(0)
    expect(parsed.finalLotCount).toBeGreaterThan(0)
    expect(parsed.selections.find((row) => row.operationReference === '7321989')).toMatchObject({
      ticker: 'YPFD',
      date: '2026-07-03',
      quantity: '2',
      rate: '1523.66',
      kind: 'MEP',
      column: 'OperacionCompraDolarMEP',
    })
    expect(parsed.selections.find((row) => row.operationReference === '7321988')).toMatchObject({
      ticker: 'PAMP',
      rate: '1572.71',
      kind: 'CCL',
      column: 'OperacionCompraDolarCCL',
    })

    const root = await mkdtemp(path.join(tmpdir(), 'july-results-first-'))
    roots.push(root)
    const database = openFileDatabase(path.join(root, 'cartera.db'))
    try {
      const view = await importSelectedDocuments({
        db: database.client,
        appDataDir: path.join(root, 'data'),
        files: createNodeImportFiles(),
        paths: [files.opening, files.closing, files.account, files.fund, REAL_RESULTS],
      })
      expect(view.outcome).toBe('created')
      expect(view.analysis?.expectedResult).toBe('1146668.00')
      expect(view.periodReturnLabel).toBe('+4,64%')
      expect(view.documents.filter((document) => document.type === 'PERIOD_RESULTS')).toHaveLength(1)
      const analysis = await analyze(database.client, view.period.id)
      await expectJulyEnrichment(database.client, analysis)
      expect(await count(database.client, 'transactions')).toBeGreaterThan(10)
    } finally {
      database.close()
    }
  }, 120_000)
})

async function expectJulyEnrichment(
  client: ReturnType<typeof openMemoryDatabase>['client'],
  analysis: Awaited<ReturnType<typeof analyze>>,
): Promise<void> {
  const rows = await client.select<{
    ticker: string | null
    type: string
    fx_rate: string
    fx_kind: string
    source_sheet: string
    source_column: string
    source_row: number
    operation_reference: string | null
    gross_amount: string | null
  }>(
    `SELECT instruments.ticker AS ticker, transactions.type AS type, enrichment.fx_rate AS fx_rate,
            enrichment.fx_kind AS fx_kind, enrichment.source_sheet AS source_sheet,
            enrichment.source_column AS source_column, enrichment.source_row AS source_row,
            enrichment.operation_reference AS operation_reference, transactions.gross_amount AS gross_amount
     FROM transaction_fx_enrichments enrichment
     JOIN transactions ON transactions.id = enrichment.transaction_id
     LEFT JOIN instruments ON instruments.id = transactions.instrument_id`,
  )
  const ypfd = rows.find((row) => row.operation_reference === '7321989')
  const pamp = rows.find((row) => row.operation_reference === '7321988')
  expect(ypfd).toMatchObject({
    ticker: 'YPFD',
    type: 'BUY',
    fx_rate: '1523.66',
    fx_kind: 'MEP',
    source_sheet: 'resultados_por_realizado',
    source_column: 'OperacionCompraDolarMEP',
    source_row: 79,
  })
  expect(pamp).toMatchObject({
    ticker: 'PAMP',
    type: 'BUY',
    fx_rate: '1572.71',
    fx_kind: 'CCL',
    source_column: 'OperacionCompraDolarCCL',
    source_row: 54,
  })
  expect(rows.find((row) => row.ticker === 'KO' && row.type === 'DIVIDEND')).toMatchObject({
    fx_rate: '1578.06',
    fx_kind: 'CCL',
    source_column: 'OperacionVentaDolarCCL',
    source_sheet: 'resultados_por_realizado',
    source_row: 38,
  })
  expect(rows.find((row) => row.ticker === 'GD30' && row.type === 'INTEREST')).toMatchObject({
    fx_rate: '1564.48',
    fx_kind: 'CCL',
    source_column: 'OperacionVentaDolarCCL',
    source_row: 19,
  })
  expect(rows.find((row) => row.ticker === 'GD35' && row.type === 'INTEREST')).toMatchObject({
    fx_rate: '1564.48',
    fx_kind: 'CCL',
    source_column: 'OperacionVentaDolarCCL',
    source_row: 24,
  })

  const instruments = await createInstrumentRepository(client).getAll()
  const tickerOf = new Map(instruments.map((instrument) => [instrument.id, instrument.ticker]))
  const flow = (ticker: string) => {
    const found = analysis.performance.positionFlows.find((item) => tickerOf.get(item.instrumentId) === ticker)
    if (!found) throw new Error(`Falta ${ticker}`)
    return found
  }
  const ypfdFlow = flow('YPFD')
  const pampFlow = flow('PAMP')
  expect(ypfdFlow.valueStatus).not.toBe('MISSING_TRANSACTION_FX')
  expect(pampFlow.valueStatus).not.toBe('MISSING_TRANSACTION_FX')
  expect(ypfdFlow.acquisitionFlows).toBe(formatExact(parseDecimal(ypfd?.gross_amount ?? '0').abs().times('1523.66')))
  expect(pampFlow.acquisitionFlows).toBe(formatExact(parseDecimal(pamp?.gross_amount ?? '0').abs().times('1572.71')))
  expect(ypfdFlow.periodPositionResult).toBe('163906.4332')
  expect(pampFlow.periodPositionResult).toBe('76512.9183')
  expect(ypfdFlow.periodPositionResult).toBe(formatExact(
    parseDecimal(ypfdFlow.closingValue ?? '0').minus(ypfdFlow.openingValue ?? '0').minus(ypfdFlow.acquisitionFlows ?? '0'),
  ))
  expect(pampFlow.periodPositionResult).toBe(formatExact(
    parseDecimal(pampFlow.closingValue ?? '0').minus(pampFlow.openingValue ?? '0').minus(pampFlow.acquisitionFlows ?? '0'),
  ))
  expect(analysis.performance.partialExplainedResult).toBe('1154484.6347')
  expect(analysis.performance.expectedResult).toBe('1146668.00')
  expect(analysis.performance.explainedResult).toBeNull()
  expect(analysis.performance.unexplainedDifference).toBeNull()
  expect(analysis.performance.pendingAttribution?.cashPerformancePending).toBe(true)
  expect(analysis.performance.pendingAttribution?.cashPerformanceReason).toMatch(/tasa ejecutada/)
  const pending = analysis.performance.pendingAttribution?.positions.map((item) => tickerOf.get(item.instrumentId)) ?? []
  expect(pending).not.toContain('YPFD')
  expect(pending).not.toContain('PAMP')
  expect(analysis.periodReturn.status).toBe('CALCULATED')
}

async function analyze(client: ReturnType<typeof openMemoryDatabase>['client'], periodId: string) {
  const periods = createPeriodRepository(client)
  const snapshots = createSnapshotRepository(client)
  const transactions = createTransactionRepository(client)
  return createPerformanceAnalysisService({
    analysis: createPeriodAnalysisService({ periods, snapshots, transactions }),
    periods,
    snapshots,
    transactions,
    corporateActions: createCorporateActionRepository(client),
    cashLegs: createCashMovementLegRepository(client),
    fxEnrichments: createTransactionFxRepository(client),
  }).analyzePeriod(periodId)
}

async function julyFiles(): Promise<{ opening: string; closing: string; account: string; fund: string } | null> {
  if (!existsSync(PRIVATE)) return null
  const { readdir } = await import('node:fs/promises')
  const names = (await readdir(PRIVATE)).filter((name) => name.toLowerCase().endsWith('.pdf'))
  const files = []
  for (const name of names) {
    const filePath = path.join(PRIVATE, name)
    const text = await extractPdfText(new Uint8Array(await readFile(filePath)))
    files.push({ path: filePath, kind: detectBalanzDocument(text), text })
  }
  const opening = files.find((file) => file.kind === 'CONSOLIDATED_POSITION' && /30\/06\/2026/.test(file.text))
  const closing = files.find((file) => file.kind === 'CONSOLIDATED_POSITION' && /31\/07\/2026/.test(file.text))
  const account = files.find(
    (file) => file.kind === 'MONTHLY_ACCOUNT' && /1\/7\/2026/.test(file.text) && /31\/7\/2026/.test(file.text),
  )
  const fund = files.find((file) => file.kind === 'MONTHLY_FUND_STATEMENT' && /31\/0?7\/2026/i.test(file.text))
  if (!opening || !closing || !account || !fund) return null
  return { opening: opening.path, closing: closing.path, account: account.path, fund: fund.path }
}

async function augustWorld() {
  const root = await mkdtemp(path.join(tmpdir(), 'august-results-'))
  roots.push(root)
  const appData = path.join(root, 'app-data')
  const inputDir = path.join(root, 'entrada')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(appData, { recursive: true })
  await mkdir(inputDir, { recursive: true })
  const database = openMemoryDatabase()
  const portfolio = await createPortfolioRepository(database.client).create({
    name: 'Mi cartera',
    broker: 'BALANZ',
    baseCurrency: 'ARS',
  })
  const files = []
  for (const [source, name] of AUGUST_SOURCES) {
    const originalPath = path.join(inputDir, name)
    await copyFile(path.join(PUBLIC, source), originalPath)
    files.push({ originalPath, originalFileName: name })
  }
  return {
    client: database.client,
    close: database.close,
    inputDir,
    portfolioId: portfolio.id,
    files,
    service: createImportPeriodService({
      db: database.client,
      appDataDir: appData,
      files: createNodeImportFiles(),
      now: () => '2026-10-05T18:00:00.000Z',
    }),
  }
}

async function count(client: { select<T>(sql: string): Promise<T[]> }, table: string): Promise<number> {
  const rows = await client.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
  return Number(rows[0]?.n ?? 0)
}

function resultsWorkbook(opening: string, closing: string): Uint8Array {
  const headers = [
    'Cantidad', 'Descripcion', 'Fecha', 'Fecha Lote', 'Gastos', 'Moneda', 'Operacion',
    'Precio Compra', 'Ticker', 'Tipo', 'DolarCCL', 'DolarMEP', 'DolarOficial',
  ]
  const realized = [
    'Cantidad', 'Descripcion', 'Fecha', 'FechaCompra', 'Gastos', 'Moneda Compra', 'Moneda Venta',
    'Operacion Compra', 'Operacion Venta', 'Precio Compra', 'PrecioVenta', 'Ticker', 'Tipo',
    'Tipo Movimiento', 'Cupones', 'Dividendos', 'Intereses', 'MTMFuturos',
    'OperacionCompraDolarCCL', 'OperacionCompraDolarMEP', 'OperacionCompraDolarOficial',
    'OperacionVentaDolarCCL', 'OperacionVentaDolarMEP', 'OperacionVentaDolarOficial',
  ]
  const book = utils.book_new()
  const lot = [headers, ['1', 'Lote', opening, opening, '0', 'Pesos', 'Boleto / 1 / COMPRA / 1 / ALUA / $', '1', 'ALUA', 'Acciones', '', '', '']]
  const finalLot = [headers, ['1', 'Lote', closing, closing, '0', 'Pesos', 'Boleto / 1 / COMPRA / 1 / ALUA / $', '1', 'ALUA', 'Acciones', '', '', '']]
  const row = realized.map((header) => {
    if (header === 'Ticker') return 'ALUA'
    if (header === 'Tipo Movimiento') return 'Orden'
    if (header === 'Moneda Compra') return 'Pesos'
    if (header === 'Fecha' || header === 'FechaCompra') return opening
    if (header === 'Operacion Compra') return 'Boleto / 100 / COMPRA / 1 / ALUA / $'
    return ''
  })
  utils.book_append_sheet(book, utils.aoa_to_sheet(lot), 'resultados_por_lotes_iniciales')
  utils.book_append_sheet(book, utils.aoa_to_sheet([realized, row]), 'resultados_por_realizado')
  utils.book_append_sheet(book, utils.aoa_to_sheet(finalLot), 'resultados_por_lotes_finales')
  return new Uint8Array(write(book, { type: 'buffer', bookType: 'xlsx' }))
}
