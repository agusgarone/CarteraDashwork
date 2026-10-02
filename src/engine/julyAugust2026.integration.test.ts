import Decimal from 'decimal.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../database/sqliteMemory'
import type { EntityId } from '../domain/common'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import {
  julyAugust2026,
  julyAugustHoldings,
  ypfStockDividend,
} from './fixtures/julyAugust2026'
import type { PeriodPerformanceAnalysis } from './models/periodPerformance'
import { createPerformanceAnalysisService } from './services/performanceAnalysisService'
import { createPeriodAnalysisService } from './services/periodAnalysisService'

const expectedChangeByTicker: Record<string, string> = {
  GGAL: '-17500.00',
  PAMP: '-56385.00',
  TECO2: '-9625.00',
  AAPL: '28280.00',
  AMZN: '-29123.00',
  GLD: '19800.00',
  GOOGL: '-12350.00',
  JPM: '16200.00',
  KO: '11400.00',
  MELI: '11500.00',
  META: '21320.00',
  MSFT: '63020.00',
  NVDA: '71000.00',
  SHEL: '3450.00',
  SLV: '13620.00',
  SMH: '27470.00',
  SPY: '168480.00',
  XLE: '16660.00',
  XLF: '6200.00',
  XLU: '-6000.00',
  PLC4O: '50400.00',
  TTCEO: '60.00',
  BCACCA: '-207892.39',
  BRTA: '-13550.69',
}

describe('fixture real julio → agosto 2026', () => {
  let closeDatabase: (() => void) | undefined
  let analysis: PeriodPerformanceAnalysis
  let tickerByInstrument = new Map<EntityId, string>()

  beforeAll(async () => {
    const database = openMemoryDatabase()
    closeDatabase = database.close
    const loaded = await loadJulyAugust(database.client)
    analysis = loaded.analysis
    tickerByInstrument = loaded.tickerByInstrument
    console.log(diagnostic(analysis, tickerByInstrument))
  })

  afterAll(() => {
    closeDatabase?.()
  })

  it('explica solo las posiciones estables y deja el resto pendiente', () => {
    expect(analysis.base.investmentResult).toBe('179959.00')
    expect(analysis.performance.expectedResult).toBe('179959.00')
    expect(analysis.performance.breakdown.dividends).toBe('0.00')
    expect(analysis.performance.breakdown.interest).toBe('0.00')
    expect(analysis.performance.breakdown.fees).toBe('0.00')
    expect(analysis.performance.breakdown.taxes).toBe('0.00')
    expect(analysis.performance.explainedResult).toBe(analysis.performance.breakdown.valuationChange)
    expect(analysis.performance.unexplainedDifference).toBe('3525.08')
    expect(analysis.performance.breakdown.valuationChange).toBe('176433.92')
    expect(analysis.performance).not.toHaveProperty('marketChange')

    expect(analysis.performance.positionResults).toHaveLength(25)
    expect(explained(analysis)).toHaveLength(24)
    expect(pending(analysis)).toHaveLength(1)

    for (const [ticker, change] of Object.entries(expectedChangeByTicker)) {
      expect(changeOf(analysis, tickerByInstrument, ticker), ticker).toBe(change)
    }

    const ypf = pending(analysis)[0]
    expect(tickerByInstrument.get(ypf?.instrumentId ?? '')).toBe('YPFD')
    expect(ypf).toMatchObject({
      status: 'HAS_CORPORATE_ACTION',
      valuationChange: null,
    })

    expect(topTickers(analysis, tickerByInstrument, 'desc')).toEqual([
      'SPY',
      'NVDA',
      'MSFT',
      'PLC4O',
      'AAPL',
    ])
    expect(topTickers(analysis, tickerByInstrument, 'asc')).toEqual([
      'BCACCA',
      'PAMP',
      'AMZN',
      'GGAL',
      'BRTA',
    ])
  })

  it('el total de valuación es la suma de las posiciones explicadas', () => {
    let total = new Decimal('0')
    for (const position of explained(analysis)) {
      total = total.plus(position.valuationChange ?? '0')
    }

    expect(total.toFixed(2)).toBe(analysis.performance.breakdown.valuationChange)
    expect(total.toFixed(2)).toBe('176433.92')
  })
})

async function loadJulyAugust(client: Parameters<typeof createPortfolioRepository>[0]) {
  const portfolios = createPortfolioRepository(client)
  const periods = createPeriodRepository(client)
  const snapshots = createSnapshotRepository(client)
  const transactions = createTransactionRepository(client)
  const instruments = createInstrumentRepository(client)
  const corporateActions = createCorporateActionRepository(client)
  const periodAnalysis = createPeriodAnalysisService({ periods, snapshots, transactions })

  const portfolio = await portfolios.create({
    name: 'Mi cartera',
    broker: 'BALANZ',
    baseCurrency: 'ARS',
  })
  const july = await periods.create({
    portfolioId: portfolio.id,
    year: 2026,
    month: 7,
    status: 'COMPLETE',
  })
  const august = await periods.create({
    portfolioId: portfolio.id,
    year: 2026,
    month: 8,
    status: 'COMPLETE',
  })
  const opening = await snapshots.createSnapshot({
    portfolioId: portfolio.id,
    periodId: july.id,
    date: '2026-07-31',
    totalValue: julyAugust2026.openingValue,
    currency: 'ARS',
    sourceDocumentId: null,
  })
  const closing = await snapshots.createSnapshot({
    portfolioId: portfolio.id,
    periodId: august.id,
    date: '2026-08-31',
    totalValue: julyAugust2026.closingValue,
    currency: 'ARS',
    sourceDocumentId: null,
  })

  const tickerByInstrument = new Map<EntityId, string>()
  for (const holding of julyAugustHoldings) {
    const instrument = await instruments.create({
      ticker: holding.ticker,
      name: holding.ticker,
      category: holding.category,
      currency: 'ARS',
      brokerIdentifier: null,
    })
    tickerByInstrument.set(instrument.id, holding.ticker)
    await snapshots.createPosition({
      snapshotId: opening.id,
      instrumentId: instrument.id,
      quantity: holding.openingQuantity,
      unitPrice: '1.00',
      marketValue: holding.openingValue,
      currency: 'ARS',
    })
    await snapshots.createPosition({
      snapshotId: closing.id,
      instrumentId: instrument.id,
      quantity: holding.closingQuantity,
      unitPrice: '1.00',
      marketValue: holding.closingValue,
      currency: 'ARS',
    })
  }

  const ypfId = [...tickerByInstrument.entries()].find(
    ([, ticker]) => ticker === ypfStockDividend.ticker,
  )?.[0]
  if (!ypfId) throw new Error('el fixture no creó YPFD')

  await corporateActions.create({
    portfolioId: portfolio.id,
    periodId: august.id,
    instrumentId: ypfId,
    date: '2026-08-31',
    type: ypfStockDividend.type,
    quantityBefore: ypfStockDividend.quantityBefore,
    quantityChange: ypfStockDividend.quantityChange,
    quantityAfter: ypfStockDividend.quantityAfter,
    ratio: null,
    description: null,
    sourceDocumentId: null,
  })

  await transactions.create({
    portfolioId: portfolio.id,
    periodId: august.id,
    instrumentId: null,
    date: '2026-08-03',
    type: 'CONTRIBUTION',
    quantity: null,
    unitPrice: null,
    grossAmount: julyAugust2026.contribution,
    netAmount: julyAugust2026.contribution,
    fees: null,
    taxes: null,
    currency: 'ARS',
    fxRate: null,
    sourceDocumentId: null,
    sourceReference: null,
  })
  await transactions.create({
    portfolioId: portfolio.id,
    periodId: august.id,
    instrumentId: null,
    date: '2026-08-18',
    type: 'WITHDRAWAL',
    quantity: null,
    unitPrice: null,
    grossAmount: julyAugust2026.withdrawal,
    netAmount: julyAugust2026.withdrawal,
    fees: null,
    taxes: null,
    currency: 'ARS',
    fxRate: null,
    sourceDocumentId: null,
    sourceReference: null,
  })

  const performance = createPerformanceAnalysisService({
    analysis: periodAnalysis,
    periods,
    snapshots,
    transactions,
    corporateActions,
  })

  return {
    analysis: await performance.analyzePeriod(august.id),
    tickerByInstrument,
  }
}

function explained(analysis: PeriodPerformanceAnalysis) {
  return analysis.performance.positionResults.filter((position) => position.status === 'EXPLAINED')
}

function pending(analysis: PeriodPerformanceAnalysis) {
  return analysis.performance.positionResults.filter((position) => position.status !== 'EXPLAINED')
}

function changeOf(
  analysis: PeriodPerformanceAnalysis,
  tickerByInstrument: Map<EntityId, string>,
  ticker: string,
) {
  return analysis.performance.positionResults.find(
    (position) => tickerByInstrument.get(position.instrumentId) === ticker,
  )?.valuationChange
}

function topTickers(
  analysis: PeriodPerformanceAnalysis,
  tickerByInstrument: Map<EntityId, string>,
  direction: 'asc' | 'desc',
) {
  return explained(analysis)
    .slice()
    .sort((left, right) => {
      const comparison = new Decimal(left.valuationChange ?? '0').cmp(right.valuationChange ?? '0')
      return direction === 'asc' ? comparison : -comparison
    })
    .slice(0, 5)
    .map((position) => tickerByInstrument.get(position.instrumentId))
}

function diagnostic(
  analysis: PeriodPerformanceAnalysis,
  tickerByInstrument: Map<EntityId, string>,
) {
  const pendingLines = pending(analysis).map((position) => {
    const ticker = tickerByInstrument.get(position.instrumentId) ?? position.instrumentId
    return `${ticker} → ${position.status}`
  })

  return [
    'EXPECTED RESULT',
    analysis.performance.expectedResult,
    '',
    'STABLE POSITION VALUATION',
    analysis.performance.breakdown.valuationChange,
    '',
    'UNEXPLAINED',
    analysis.performance.unexplainedDifference,
    '',
    'POSITIONS EXPLAINED',
    String(explained(analysis).length),
    '',
    'POSITIONS PENDING',
    String(pending(analysis).length),
    '',
    'PENDING:',
    ...pendingLines,
  ].join('\n')
}
