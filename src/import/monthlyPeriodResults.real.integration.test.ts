import { createHash } from 'node:crypto'
import { createPeriodFxReferenceService } from '../services/periodFxReferenceService'
import { createDocumentRepository } from '../repositories/documentRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { readExplicitOperationTicker } from '../parsers/balanz/operationTicker'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createPeriodAnalysisService } from '../engine/services/periodAnalysisService'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createCashMovementLegRepository } from '../repositories/cashMovementLegRepository'
import { createTransactionFxRepository } from '../repositories/transactionFxRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { reconcileCashLedger } from '../engine/calculations/cashLedger'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { importSelectedDocuments } from '../application/importPeriodApplication'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { parseBalanzPeriodResults } from '../parsers/balanz/periodResults'
import { parseBalanzConsolidatedPositionDocument } from '../parsers/balanz/consolidatedPosition'
import { extractPdfDocument } from '../parsers/text/extractPdfText'
import { createNodeImportFiles } from './nodeImportFiles'
import { matchesPeriodClose } from './snapshotPeriodDate'

const root = fileURLToPath(new URL('../parsers/balanz/fixtures/private/', import.meta.url))
const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto']
type Fixture = { month: number; folder: string; opening: string; closing: string; account: string; fund: string; excel: string }
let fixturesPromise: Promise<Fixture[]> | undefined

async function fixtures(): Promise<Fixture[]> {
  fixturesPromise ??= loadFixtures()
  return fixturesPromise
}

async function loadFixtures(): Promise<Fixture[]> {
  const positions: { path: string; date: string }[] = []
  const filesByMonth: string[][] = []
  for (const folder of months) {
    const directory = path.join(root, folder)
    if (!existsSync(directory)) throw new Error(`Falta el directorio privado ${folder}`)
    const files = (await readdir(directory)).map(name => path.join(directory, name))
    filesByMonth.push(files)
    for (const file of files.filter(file => path.basename(file).startsWith('ResumenDeCuenta_'))) {
      const parsed = parseBalanzConsolidatedPositionDocument(await extractPdfDocument(new Uint8Array(await readFile(file))))
      positions.push({ path: file, date: parsed.snapshotDate })
    }
  }
  return months.map((folder, index) => {
    const month = index + 1
    const start = `2026-${String(month).padStart(2, '0')}-01`
    const end = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10)
    const closing = positions.find(position => matchesPeriodClose(position.date, end))
    const opening = positions.filter(position => position.date < start).sort((a, b) => b.date.localeCompare(a.date))[0]
    const files = filesByMonth[index]!
    const account = files.find(file => path.basename(file).startsWith('ResumenEstadodeCuenta'))
    const fund = files.find(file => path.basename(file).startsWith('ResumenFCI'))
    const excel = files.find(file => file.endsWith('.xlsx'))
    if (!opening || !closing || !account || !fund || !excel) throw new Error(`Documentos incompletos para ${folder}`)
    return { month, folder, opening: opening.path, closing: closing.path, account, fund, excel }
  })
}

async function counts(db: ReturnType<typeof openMemoryDatabase>['client']) {
  return db.select(`SELECT (SELECT COUNT(*) FROM snapshots) AS snapshots,
    (SELECT COUNT(*) FROM transactions) AS transactions,
    (SELECT COUNT(*) FROM documents) AS documents,
    (SELECT COUNT(*) FROM transaction_fx_enrichments) AS enrichments`)
}

async function assertProvenance(db: ReturnType<typeof openMemoryDatabase>['client']) {
  expect(await db.select(`SELECT e.id FROM transaction_fx_enrichments e
    LEFT JOIN transactions t ON t.id = e.transaction_id
    LEFT JOIN documents d ON d.id = e.source_document_id
    WHERE t.id IS NULL OR d.id IS NULL OR d.type <> 'PERIOD_RESULTS'
      OR e.source_row < 2 OR e.source_sheet = '' OR e.source_column = ''`)).toEqual([])
  const rows = await db.select<{ fx_rate: string }>('SELECT fx_rate FROM transaction_fx_enrichments')
  for (const row of rows) expect(new Decimal(row.fx_rate).gt(0)).toBe(true)
}

async function inspectAnalysis(db: ReturnType<typeof openMemoryDatabase>['client'], periodId: string) {
  const periods = createPeriodRepository(db)
  const snapshots = createSnapshotRepository(db)
  const transactions = createTransactionRepository(db)
  const cashLegs = createCashMovementLegRepository(db)
  const analysis = await createPerformanceAnalysisService({
    instruments: createInstrumentRepository(db),
    analysis: createPeriodAnalysisService({ periods, snapshots, transactions }),
    periods, snapshots, transactions, cashLegs,
    corporateActions: createCorporateActionRepository(db), fxEnrichments: createTransactionFxRepository(db),
  }).analyzePeriod(periodId)
  const stored = await db.select<{ id: number }>('SELECT id FROM snapshots ORDER BY date')
  const opening = await snapshots.getAggregate(String(stored[0]!.id))
  const closing = await snapshots.getAggregate(String(stored[stored.length - 1]!.id))
  const ledger = reconcileCashLedger({ opening: opening!.cashBalances, closing: closing!.cashBalances, legs: await cashLegs.getByPeriod(periodId) })
  const instruments = await createInstrumentRepository(db).getAll()
  const tickerOf = new Map(instruments.map(row => [row.id, row.ticker]))
  const sourceTotals = [opening!, closing!].map(snapshot => {
    const positions = snapshot.positions.reduce((sum, row) => sum.plus(row.marketValue), new Decimal(0))
    const cash = snapshot.cashBalances.reduce((sum, row) => sum.plus(
      row.valueInBaseCurrency ?? new Decimal(row.amount).times(row.fxRate ?? '1').toString(),
    ), new Decimal(0))
    return { date: snapshot.snapshot.date, reported: snapshot.snapshot.totalValue,
      detail: positions.plus(cash).toFixed(4), difference: positions.plus(cash).minus(snapshot.snapshot.totalValue).toFixed(4) }
  })
  return {
    sourceTotals,
    identityReconciliation: analysis.identityReconciliation,
    ledger,
    positions: analysis.performance.positionFlows.map(row => ({
      ticker: tickerOf.get(row.instrumentId), quantity: row.quantity, status: row.valueStatus,
      result: row.periodPositionResult,
    })),
    transactions: (await transactions.getByPeriod(periodId)).map(row => ({
      ticker: row.instrumentId ? tickerOf.get(row.instrumentId) : null, type: row.type, quantity: row.quantity, date: row.date, gross: row.grossAmount, net: row.netAmount, currency: row.currency, source: row.sourceReference,
    })),
    partialExplainedResult: analysis.performance.partialExplainedResult,
    explainedResult: analysis.performance.explainedResult,
    unexplainedDifference: analysis.performance.unexplainedDifference,
    performanceStatus: analysis.performance.attributionStatus,
    cashStatus: analysis.performance.cash.status,
  }
}
const individualReport: Record<string, unknown> = {}

describe('Excel real como enrichment de meses ya importados', () => {
  for (const [index, folder] of months.entries()) it(folder, async (context) => {
    if (!existsSync(root)) return context.skip('Faltan los documentos privados')
    const fixture = (await fixtures())[index]!
    const parsed = parseBalanzPeriodResults(new Uint8Array(await readFile(fixture.excel)))
    expect(parsed.closingDate).toBe(new Date(Date.UTC(2026, fixture.month, 0)).toISOString().slice(0, 10))
    const paths = [fixture.opening, fixture.closing, fixture.account, fixture.fund]
    const database = openMemoryDatabase()
    const appDataDir = await mkdtemp(path.join(tmpdir(), 'monthly-excel-'))
    try {
      const options = { db: database.client, appDataDir, files: createNodeImportFiles(), paths }
      const before = await importSelectedDocuments(options)
      const fxService = createPeriodFxReferenceService({
        periods: createPeriodRepository(database.client), portfolios: createPortfolioRepository(database.client),
        snapshots: createSnapshotRepository(database.client), documents: createDocumentRepository(database.client),
      })
      const changesBeforeReference = await database.client.select('SELECT total_changes() AS changes')
      const usdReference = await fxService.getPeriodUsdMepReference(before.period.id)
      expect(await database.client.select('SELECT total_changes() AS changes')).toEqual(changesBeforeReference)
      const closingBytes = new Uint8Array(await readFile(fixture.closing))
      const closingPdf = parseBalanzConsolidatedPositionDocument(await extractPdfDocument(closingBytes))
      expect(usdReference.status).toBe('AVAILABLE')
      if (usdReference.status !== 'AVAILABLE') throw new Error(`Falta USD MEP para ${folder}: ${usdReference.reason}`)
      expect(usdReference.rate).toBe(closingPdf.cashBalances.find(row => row.currency === 'USD_MEP')?.fxRate)
      expect(usdReference.date).toBe(closingPdf.snapshotDate)
      expect(usdReference.source).toMatchObject({ kind: 'EXPLICIT_SNAPSHOT_RATE', originalFilename: path.basename(fixture.closing),
        sha256: createHash('sha256').update(closingBytes).digest('hex'), field: 'cash_balances.fx_rate' })
      if (fixture.month === 1) expect(usdReference.date).toBe('2026-01-30')
      if (fixture.month === 7) expect(usdReference).toMatchObject({ rate: '1518.19', date: '2026-07-31' })
      if (fixture.month === 8) expect(usdReference).toMatchObject({ rate: '1534.51', date: '2026-08-31' })
      expect(await database.client.select('SELECT * FROM snapshots WHERE id = $1', [usdReference.snapshotId])).toHaveLength(1)
      const snapshots = await database.client.select('SELECT * FROM snapshots ORDER BY id')
      const transactions = await database.client.select('SELECT * FROM transactions ORDER BY id')
      const documentsBefore = await database.client.select<{ count: number }>('SELECT COUNT(*) AS count FROM documents')
      const enriched = await importSelectedDocuments({ ...options, paths: [...paths, fixture.excel] })
      expect(enriched.period.month).toBe(fixture.month)
      expect(enriched.analysis?.expectedResult).toBe(before.analysis?.expectedResult)
      expect(enriched.periodReturnLabel).toBe(before.periodReturnLabel)
      expect(await database.client.select('SELECT * FROM snapshots ORDER BY id')).toEqual(snapshots)
      expect(await database.client.select('SELECT * FROM transactions ORDER BY id')).toEqual(transactions)
      const documentsAfter = await database.client.select<{ count: number }>('SELECT COUNT(*) AS count FROM documents')
      expect(documentsAfter[0]!.count).toBe(documentsBefore[0]!.count + 1)
      await assertProvenance(database.client)
      const saved = await counts(database.client)
      expect((await importSelectedDocuments({ ...options, paths: [...paths, fixture.excel] })).outcome).toBe('existing')
      expect(await counts(database.client)).toEqual(saved)
      expect(await fxService.getPeriodUsdMepReference(before.period.id)).toEqual(usdReference)
      const fresh = openMemoryDatabase()
      try {
        const firstWithExcel = await importSelectedDocuments({
          ...options, db: fresh.client, appDataDir: await mkdtemp(path.join(tmpdir(), 'monthly-excel-first-')),
          paths: [...paths, fixture.excel],
        })
        expect(firstWithExcel.analysis?.expectedResult).toBe(before.analysis?.expectedResult)
        expect(firstWithExcel.periodReturnLabel).toBe(before.periodReturnLabel)
        expect(await counts(fresh.client)).toEqual(saved)
      } finally { fresh.close() }
      const storedOperations = await database.client.select<{ ticker: string | null; source_reference: string | null }>(
        `SELECT instruments.ticker, transactions.source_reference FROM transactions
         LEFT JOIN instruments ON instruments.id = transactions.instrument_id`,
      )
      for (const operation of storedOperations) {
        const explicit = readExplicitOperationTicker(operation.source_reference ?? '')
        if (explicit) expect(operation.ticker).toBe(explicit)
      }
      const inspection = await inspectAnalysis(database.client, enriched.period.id)
      expect(inspection.ledger.status).toBe('RECONCILED')
      individualReport[folder] = {
        inspection,
        usdReference,
        periodEnd: parsed.closingDate,
        result: enriched.analysis?.expectedResult, dietz: enriched.periodReturnLabel,
        cashLedgerReconciled: enriched.cashLedgerReconciled, partial: enriched.positionAttributionPartial,
        counts: saved[0], workbook: { opening: parsed.openingDate, closing: parsed.closingDate, selections: parsed.selections.length },
      }
      await writeFile(path.join(root, 'validation-monthly-report.json'), JSON.stringify(individualReport, null, 2))
    } finally { database.close() }
  }, 120_000)
})

describe('recorrido Enero a Agosto en una misma base', () => {
  it('comparte nueve snapshots, agrega los ocho Excel y reimporta sin duplicar', async (context) => {
    if (!existsSync(root)) return context.skip('Faltan los documentos privados')
    const loaded = await fixtures()
    const database = openMemoryDatabase()
    const appDataDir = await mkdtemp(path.join(tmpdir(), 'chronological-excel-'))
    try {
      const base = { db: database.client, appDataDir, files: createNodeImportFiles() }
      const results = new Map<number, string | undefined>()
      const periodIds = new Map<number, string>()
      const fxService = createPeriodFxReferenceService({
        periods: createPeriodRepository(database.client), portfolios: createPortfolioRepository(database.client),
        snapshots: createSnapshotRepository(database.client), documents: createDocumentRepository(database.client),
      })
      for (const fixture of loaded) {
        const paths = [fixture.closing, fixture.account, fixture.fund]
        if (fixture.month === 1) paths.unshift(fixture.opening)
        const view = await importSelectedDocuments({ ...base, paths })
        expect(view.period.month).toBe(fixture.month)
        results.set(fixture.month, view.analysis?.expectedResult)
        periodIds.set(fixture.month, view.period.id)
      }
      expect(await database.client.select('SELECT COUNT(*) AS count FROM snapshots')).toEqual([{ count: 9 }])
      expect(await database.client.select('SELECT COUNT(*) AS count FROM documents')).toEqual([{ count: 25 }])
      for (const fixture of loaded) {
        const view = await importSelectedDocuments({ ...base, paths: [fixture.closing, fixture.account, fixture.fund, fixture.excel] })
        expect(view.analysis?.expectedResult).toBe(results.get(fixture.month))
      }
      expect(await database.client.select('SELECT COUNT(*) AS count FROM documents')).toEqual([{ count: 33 }])
      await assertProvenance(database.client)
      const saved = await counts(database.client)
      for (const fixture of loaded) {
        const view = await importSelectedDocuments({ ...base, paths: [fixture.closing, fixture.account, fixture.fund, fixture.excel] })
        expect(view.outcome).toBe('existing')
        expect(view.analysis?.expectedResult).toBe(results.get(fixture.month))
      }
      expect(await counts(database.client)).toEqual(saved)
      expect(await database.client.select('SELECT date FROM snapshots GROUP BY date HAVING COUNT(*) > 1')).toEqual([])
      for (const fixture of loaded) {
        const reference = await fxService.getPeriodUsdMepReference(periodIds.get(fixture.month)!)
        const expected = individualReport[fixture.folder] as { usdReference: { rate: string; date: string } }
        expect(reference).toMatchObject({ status: 'AVAILABLE', rate: expected.usdReference.rate, date: expected.usdReference.date })
      }
    } finally { database.close() }
  }, 180_000)
})
// Importability and complete quantity reconciliation are separate acceptance checks.
describe('cantidades reconciliadas después del Excel', () => {
  for (const folder of months) it(folder, async (context) => {
    if (!existsSync(root)) return context.skip('Faltan los documentos privados')
    const report = individualReport[folder] as { inspection: { positions: { ticker: string; quantity: { status: string; difference: string } }[] } } | undefined
    expect(report, 'Debe completarse primero el test real del mes').toBeDefined()
    expect(report!.inspection.positions.filter(row => row.quantity.status !== 'RECONCILED')
      .map(row => ({ ticker: row.ticker, difference: row.quantity.difference }))).toEqual([])
  })
})
describe('instrumentos de una letra presentes en los documentos reales', () => {
  for (const [folder, value] of [['Febrero', '426600'], ['Marzo', '445200']]) it(`C en ${folder}`, async (context) => {
    if (!existsSync(root)) return context.skip('Faltan los documentos privados')
    const report = individualReport[folder!] as { inspection: { positions: { ticker: string; quantity: { actualClosingQuantity: string }; result: string | null }[] } }
    const position = report.inspection.positions.find(row => row.ticker === 'C')
    expect(position, `C debe estar presente: ocho unidades, valor ${value} según el PDF`).toBeDefined()
    expect(position!.quantity.actualClosingQuantity).toBe('8')
  })
})
describe('operaciones reales corregidas', () => {
  it('Abril vende C sin atribuir la venta a AAPL y conserva BITF separado de KEEL', () => {
    const report = individualReport.Abril as { inspection: { transactions: { ticker: string; type: string; quantity: string; source: string }[] } }
    const rows = report.inspection.transactions
    expect(rows.find(row => row.source.includes('3803739'))).toMatchObject({ ticker: 'C', type: 'SELL', quantity: '-8' })
    expect(rows.some(row => row.ticker === 'AAPL' && row.type === 'SELL')).toBe(false)
    expect(rows.find(row => row.source.includes('3803745'))).toMatchObject({ ticker: 'BITF', type: 'SELL', quantity: '-11' })
    expect(rows.some(row => row.ticker === 'KEEL' && row.type === 'SELL')).toBe(false)
  })
  it('Mayo conserva la adquisición real TTCEO y su cantidad', () => {
    const report = individualReport.Mayo as { inspection: { transactions: { ticker: string; type: string; quantity: string; date: string; gross: string; net: string; currency: string; source: string }[] } }
    expect(report.inspection.transactions.find(row => row.source.includes('5549622'))).toMatchObject({
      ticker: 'TTCEO', type: 'BUY', quantity: '4', date: '2026-05-19', gross: '4.00', net: '-4.02', currency: 'USD_MEP',
    })
  })
})
describe('auditoría de identidad cruda y cadena económica', () => {
  it('Abril conserva 37 identidades crudas reconciliadas y calcula una sola cadena BITF/KEEL', () => {
    const report = individualReport.Abril as { inspection: {
      identityReconciliation: { quantities: { rawTicker: string; status: string }[]; appliedTransitions: { fromTicker: string; toTicker: string; effectiveDate: string; ratio: string; source: string }[] },
      positions: { ticker: string; quantity: { status: string }; result: string }[],
      transactions: { ticker: string; source: string; quantity: string }[],
    } }
    const audit = report.inspection.identityReconciliation
    expect(audit.quantities).toHaveLength(37)
    expect(audit.quantities.every(row => row.status === 'RECONCILED')).toBe(true)
    expect(audit.appliedTransitions).toEqual([expect.objectContaining({ fromTicker: 'BITF', toTicker: 'KEEL', effectiveDate: '2026-04-06', ratio: '1' })])
    expect(audit.appliedTransitions[0].source).toMatch(/^https:/)
    expect(report.inspection.positions).toHaveLength(36)
    expect(report.inspection.positions.find(row => row.ticker === 'KEEL')).toMatchObject({ result: '13720.00', quantity: { status: 'RECONCILED' } })
    expect(report.inspection.transactions.find(row => row.source.includes('3803745'))).toMatchObject({ ticker: 'BITF', quantity: '-11' })
  })
  it('mantiene el conteo crudo de los ocho meses sin duplicar cadenas económicas', () => {
    for (const [index, count] of [31, 30, 30, 37, 27, 26, 27, 25].entries()) {
      const report = individualReport[months[index]] as { inspection: { identityReconciliation: { quantities: { status: string }[] } } }
      const rows = report.inspection.identityReconciliation.quantities
      expect(rows).toHaveLength(count)
      expect(rows.every(row => row.status === 'RECONCILED')).toBe(true)
    }
  })
})