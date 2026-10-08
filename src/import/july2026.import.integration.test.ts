/// <reference types="node" />

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { importSelectedDocuments } from '../application/importPeriodApplication'
import { importOutcomeCopy } from '../application/importDialogState'
import { PARTIAL_ATTRIBUTION_NOTE, reconciliationNote } from '../application/overviewCopy'
import { loadPortfolioDetail } from '../application/portfolioDetail'
import { loadPortfolioOverview } from '../application/portfolioOverview'
import { openFileDatabase } from '../database/sqliteMemory'
import { calculateExpectedInvestmentResult } from '../engine/calculations/investmentResult'
import { formatExact, parseDecimal } from '../engine/money'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createPeriodAnalysisService } from '../engine/services/periodAnalysisService'
import { formatReturnPercent } from '../utils/formatPercentage'
import { parseBalanzMonthlyAccountDocument } from '../parsers/balanz/monthlyAccount'
import { parseBalanzMonthlyFundStatementDocument } from '../parsers/balanz/monthlyFundStatement'
import { statementLinesFromPdf } from '../parsers/balanz/statementTable'
import { extractPdfDocument, extractPdfText } from '../parsers/text/extractPdfText'
import { createCashMovementLegRepository } from '../repositories/cashMovementLegRepository'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { detectBalanzDocument } from './detectDocument'
import { createNodeImportFiles } from './nodeImportFiles'

const PRIVATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../parsers/balanz/fixtures/private')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('importación real de junio a julio 2026', () => {
  it('persiste julio con el aporte fechado y deja el análisis de operaciones internas pendiente', async (context) => {
    const files = await julyFiles()
    if (!files) {
      context.skip('Los PDF privados de junio y julio no están en esta máquina.')
      return
    }

    expect(calculateExpectedInvestmentResult({
      openingValue: '23007361',
      closingValue: '25954029',
      contributions: '1800000.00',
      withdrawals: '0.00',
    })).toBe('1146668.00')

    const accountDocument = await extractPdfDocument(new Uint8Array(await readFile(files.account)))
    const account = parseBalanzMonthlyAccountDocument(accountDocument)
    const lines = statementLinesFromPdf(accountDocument)
    expect(account.period).toEqual({ startDate: '2026-07-01', endDate: '2026-07-31' })
    expect(lines.filter((line) => line.cells.tradeDate).length).toBeGreaterThan(0)
    expect(account.warnings.some((warning) => warning.code === 'MISSING_DATE')).toBe(false)
    expect(account.transactions.filter((movement) => movement.type === 'BUY')).toHaveLength(5)
    expect(account.transactions.filter((movement) => movement.type === 'SELL')).toHaveLength(2)
    expect(account.transactions.find((movement) => movement.type === 'CONTRIBUTION')).toMatchObject({
      date: '2026-07-02',
      netAmount: '1800000.00',
      currency: 'ARS',
    })

    const fund = parseBalanzMonthlyFundStatementDocument(
      await extractPdfDocument(new Uint8Array(await readFile(files.fund))),
    )
    expect(fund.reportDate).toBe('2026-07-31')
    expect(count(fund.funds.flatMap((statement) => statement.rows.map((row) => row.type)))).toMatchObject({
      SUBSCRIPTION: 2,
    })

    const root = await mkdtemp(path.join(tmpdir(), 'july-import-'))
    roots.push(root)
    const database = openFileDatabase(path.join(root, 'cartera.db'))
    try {
      const view = await importSelectedDocuments({
        db: database.client,
        appDataDir: path.join(root, 'data'),
        files: createNodeImportFiles(),
        paths: [files.opening, files.closing, files.account, files.fund],
      })

      expect(view.outcome).toBe('created')
      expect(view.period).toMatchObject({ year: 2026, month: 7, status: 'COMPLETE' })
      expect(view.summary.transactionsCount).toBeGreaterThan(0)
      expect(view.cashLedgerReconciled).toBe(true)
      expect(view.positionAttributionPartial).toBe(true)
      expect(view.analysis?.expectedResult).toBe('1146668.00')
      expect(view.analysis?.explainedResult).toBeNull()
      expect(view.analysis?.unexplainedDifference).toBeNull()
      expect(view.periodReturnLabel).toBe('+4,64%')
      expect(view.unsupportedInternalMovements).toBe(false)
      expect(importOutcomeCopy(view).lead).toBe(PARTIAL_ATTRIBUTION_NOTE)

      const snapshots = await database.client.select<{ date: string; total_value: string }>(
        'SELECT date, total_value FROM snapshots ORDER BY date',
      )
      expect(snapshots).toEqual([
        { date: '2026-06-30', total_value: '23007361' },
        { date: '2026-07-31', total_value: '25954029' },
      ])

      const base = await createPeriodAnalysisService({
        periods: createPeriodRepository(database.client),
        snapshots: createSnapshotRepository(database.client),
        transactions: createTransactionRepository(database.client),
      }).analyzePeriod(view.period.id)
      expect(base.investmentResult).toBe('1146668.00')
      expect(base.contributions).toBe('1800000.00')
      expect(base.withdrawals).toBe('0.00')

      const stored = await database.client.select<{ type: string; date: string; net_amount: string; quantity: string | null }>(
        'SELECT type, date, net_amount, quantity FROM transactions ORDER BY date, type',
      )
      expect(stored.filter((row) => row.type === 'CONTRIBUTION')).toEqual([
        expect.objectContaining({ date: '2026-07-02', net_amount: '1800000.00' }),
      ])
      expect(stored.filter((row) => row.type === 'FUND_SUBSCRIPTION')).toEqual([
        expect.objectContaining({ date: '2026-07-03', quantity: '8264.466250', net_amount: '1350000.00' }),
        expect.objectContaining({ date: '2026-07-03', quantity: '1937.575988', net_amount: '1430279.89' }),
      ])
      expect(count(stored.map((row) => row.type))).toEqual({
        BUY: 5,
        SELL: 2,
        FUND_SUBSCRIPTION: 2,
        CONTRIBUTION: 1,
        DIVIDEND: 3,
        INTEREST: 4,
        TAX: 1,
        FX_CONVERSION: 2,
      })

      const runs = await database.client.select<{ status: string }>(
        'SELECT status FROM reconciliation_runs',
      )
      expect(runs).toEqual([])

      const cash = await database.client.select<{ date: string; currency: string; amount: string }>(
        `SELECT snapshots.date AS date, cash_balances.currency AS currency, cash_balances.amount AS amount
         FROM cash_balances
         JOIN snapshots ON snapshots.id = cash_balances.snapshot_id
         ORDER BY snapshots.date, cash_balances.currency`,
      )
      expect(cash).toEqual([
        { date: '2026-06-30', currency: 'ARS', amount: '2059863.56' },
        { date: '2026-06-30', currency: 'USD_CABLE', amount: '173.89' },
        { date: '2026-06-30', currency: 'USD_MEP', amount: '105.23' },
        { date: '2026-07-31', currency: 'ARS', amount: '17658.61' },
        { date: '2026-07-31', currency: 'USD_CABLE', amount: '0.00' },
        { date: '2026-07-31', currency: 'USD_MEP', amount: '188.58' },
      ])

      const overview = await loadPortfolioOverview({ db: database.client, periodId: view.period.id })
      expect(overview?.metrics.currentPortfolioValue).toBe('25954029')
      expect(overview?.metrics.investmentResult).toBe('1146668.00')
      expect(overview?.metrics.explainedResult).toBeNull()
      expect(overview?.metrics.unexplainedDifference).toBeNull()
      expect(overview?.metrics.contributions).toBe('1800000.00')
      expect(overview?.metrics.positionAttribution).toBe('PARTIAL')
      expect(overview?.resultBreakdown).toBeNull()
      expect(overview?.periodReturn?.status).toBe('CALCULATED')
      expect(formatReturnPercent(overview?.periodReturn?.decimal ?? '')).toBe('+4,64%')
      expect(reconciliationNote(
        overview?.metrics.reconciliationStatus ?? null,
        overview?.metrics.unexplainedDifference ?? null,
        overview?.metrics.performanceAttribution ?? null,
        overview?.metrics.positionAttribution ?? null,
      )).toBe(PARTIAL_ATTRIBUTION_NOTE)

      const analysis = await createPerformanceAnalysisService({
        analysis: createPeriodAnalysisService({
          periods: createPeriodRepository(database.client),
          snapshots: createSnapshotRepository(database.client),
          transactions: createTransactionRepository(database.client),
        }),
        periods: createPeriodRepository(database.client),
        snapshots: createSnapshotRepository(database.client),
        transactions: createTransactionRepository(database.client),
        corporateActions: createCorporateActionRepository(database.client),
        cashLegs: createCashMovementLegRepository(database.client),
      }).analyzePeriod(view.period.id)
      const flows = analysis.performance.positionFlows
      const instruments = await createInstrumentRepository(database.client).getAll()
      const tickerOf = new Map(instruments.map((instrument) => [instrument.id, instrument.ticker]))
      const byTicker = (ticker: string) => {
        const flow = flows.find((item) => tickerOf.get(item.instrumentId) === ticker)
        if (!flow) throw new Error(`Falta ${ticker}`)
        return flow
      }

      expect(flows).toHaveLength(27)
      expect(flows.filter((flow) => flow.quantity.status === 'QUANTITY_MISMATCH')).toEqual([])
      expect(flows.every((flow) => flow.quantity.status === 'RECONCILED')).toBe(true)
      expect(byTicker('YPFD').quantity).toMatchObject({
        openingQuantity: '12',
        boughtQuantity: '2',
        expectedClosingQuantity: '14',
        actualClosingQuantity: '14',
      })
      expect(byTicker('PAMP').quantity).toMatchObject({ openingQuantity: '150', boughtQuantity: '29', actualClosingQuantity: '179' })
      expect(byTicker('SPY').quantity).toMatchObject({ openingQuantity: '87', boughtQuantity: '129', actualClosingQuantity: '216' })
      expect(byTicker('SMH').quantity).toMatchObject({ openingQuantity: '0', boughtQuantity: '41', actualClosingQuantity: '41' })
      expect(byTicker('SMH').valueStatus).toBe('OPENED_DURING_PERIOD')
      expect(byTicker('GD30').quantity).toMatchObject({ openingQuantity: '919', soldQuantity: '919', actualClosingQuantity: '0' })
      expect(byTicker('GD30').valueStatus).toBe('CLOSED_DURING_PERIOD')
      expect(byTicker('GD35').quantity).toMatchObject({ openingQuantity: '1098', soldQuantity: '1098', actualClosingQuantity: '0' })
      expect(byTicker('GD35').valueStatus).toBe('CLOSED_DURING_PERIOD')
      expect(byTicker('BCACCA').quantity).toMatchObject({
        openingQuantity: '6596.326243',
        subscribedQuantity: '8264.466250',
        actualClosingQuantity: '14860.792493',
      })
      expect(byTicker('BRTA').quantity).toMatchObject({
        openingQuantity: '1277.016785',
        subscribedQuantity: '1937.575988',
        actualClosingQuantity: '3214.592773',
      })
      expect(byTicker('YPFD').valueStatus).toBe('MISSING_TRANSACTION_FX')
      expect(byTicker('YPFD').periodPositionResult).toBeNull()
      expect(byTicker('PAMP').valueStatus).toBe('MISSING_TRANSACTION_FX')
      expect(byTicker('PAMP').periodPositionResult).toBeNull()
      expect(byTicker('SPY').valueStatus).toBe('VALUATION_EXPLAINED')
      expect(byTicker('SPY').acquisitionFlows).toBe('2528190.00')
      expect(byTicker('SPY').periodPositionResult).toBe('25320.00')
      expect(byTicker('SMH').periodPositionResult).toBe('9430.00')
      expect(byTicker('GD30').periodPositionResult).toBe('-103112.30')
      expect(byTicker('GD35').periodPositionResult).toBe('-31402.60')
      expect(byTicker('BCACCA').periodPositionResult).toBe('76901.82')
      expect(byTicker('BRTA').periodPositionResult).toBe('32081.48')
      expect(analysis.performance.partialExplainedResult).toBe('759606.24')
      expect(byTicker('AAPL').quantity).toMatchObject({
        boughtQuantity: '0',
        soldQuantity: '0',
        status: 'RECONCILED',
      })
      expect(byTicker('AAPL').periodPositionResult).toBe(
        moneyDelta(byTicker('AAPL').closingValue, byTicker('AAPL').openingValue),
      )
      expect(analysis.performance.explainedResult).toBeNull()
      expect(analysis.performance.unexplainedDifference).toBeNull()
      expect(
        analysis.performance.pendingAttribution?.positions.map((item) => tickerOf.get(item.instrumentId)).sort(),
      ).toEqual(['PAMP', 'YPFD'])
      expect(analysis.performance.pendingAttribution?.cashPerformancePending).toBe(true)

      const detail = await loadPortfolioDetail({ db: database.client, periodId: view.period.id })
      const ypfd = detail?.instruments.find((row) => row.ticker === 'YPFD')
      const gd30 = detail?.instruments.find((row) => row.ticker === 'GD30')
      expect(ypfd?.flowNote).toBe('Pendiente: falta tipo de cambio de la operación.')
      expect(ypfd?.valuationChange).toBeNull()
      expect(gd30?.statusLabel).toBe('Cerrada en el período')
      expect(gd30?.valuationChange).not.toBeNull()
      expect(gd30?.quantity).toBe('0')
    } finally {
      database.close()
    }
  }, 120_000)
})

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
  const fund = files.find((file) => {
    if (file.kind !== 'MONTHLY_FUND_STATEMENT') return false
    return /informe del total de su inversi[oó]n al:?\s*31\/0?7\/2026/i.test(file.text)
  })
  if (!opening || !closing || !account || !fund) return null
  return { opening: opening.path, closing: closing.path, account: account.path, fund: fund.path }
}

function moneyDelta(closing: string | null, opening: string | null): string {
  return formatExact(parseDecimal(closing ?? '0').minus(opening ?? '0'))
}

function count(values: string[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const value of values) totals[value] = (totals[value] ?? 0) + 1
  return totals
}
