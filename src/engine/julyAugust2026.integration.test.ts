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
  julyAugustCash,
  julyAugustCableDividends,
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
    expect(analysis.performance.breakdown.valuationChange).toBe('171533.92')
    expect(analysis.base.netContributions).toBe('250000.00')
    expect(analysis.performance.cash.externalNetFlows).toBe(analysis.base.netContributions)
    expect(analysis.performance.cash.status).toBe('EXPLAINED')
    expect(exact(analysis.performance.cash.openingCashValue)).toBe('303958.8802')
    expect(exact(analysis.performance.cash.closingCashValue)).toBe('562383.0962')
    expect(exact(analysis.performance.cash.totalCashValueChange)).toBe('258424.2160')
    expect(exact(analysis.performance.cash.cashEconomicResult)).toBe('8424.2160')
    expect(exact(analysis.performance.breakdown.cashEconomicResult)).toBe('8424.2160')
    expect(exact(mep(analysis)?.fxValuationChange)).toBe('3077.6256')
    expect(mep(analysis)?.status).toBe('UNCHANGED_AMOUNT')
    expect(currencyAttribution(analysis, 'USD_MEP')?.amountStatus).toBe('RECONCILED')
    expect(currencyAttribution(analysis, 'USD_MEP')?.attributionStatus).toBe('FX_ONLY')
    expect(cable(analysis)?.status).toBe('AMOUNT_CHANGED')
    expect(currencyAttribution(analysis, 'USD_CABLE')?.amountStatus).toBe('RECONCILED')
    expect(currencyAttribution(analysis, 'USD_CABLE')?.attributionStatus).toBe('MISSING_TRANSACTION_FX')
    expect(exact(currencyAttribution(analysis, 'USD_CABLE')?.dividendInflows)).toBe('3.3400')
    expect(exact(currencyAttribution(analysis, 'USD_CABLE')?.classifiedAmountChange)).toBe('3.3400')
    expect(exact(currencyAttribution(analysis, 'USD_CABLE')?.amountDifference)).toBe('0.0000')
    expect(analysis.performance.cash.attribution?.dividends).toBe('0.00')
    expect(currencyAttribution(analysis, 'ARS')?.amountStatus).toBe('AMOUNT_MISMATCH')
    expect(currencyAttribution(analysis, 'ARS')?.attributionStatus).toBe('BASE_CURRENCY')
    expect(exact(currencyAttribution(analysis, 'ARS')?.amountDifference)).toBe('0.7200')
    expect(cable(analysis)?.fxValuationChange).toBeNull()
    expect(exact(cable(analysis)?.closingValue)).toBe('5345.8704')
    expect(exact(analysis.performance.explainedResult)).toBe('179958.1360')
    expect(exact(analysis.performance.unexplainedDifference)).toBe('0.8640')
    expect(analysis.performance.unexplainedDifference).not.toBe('0.00')
    expect(analysis.periodReturn.status).toBe('CALCULATED')
    if (analysis.periodReturn.status === 'CALCULATED') {
      expect(analysis.periodReturn.method).toBe('MODIFIED_DIETZ')
      expect(analysis.periodReturn.numerator).toBe(analysis.base.investmentResult)
      expect(new Decimal(analysis.periodReturn.weightedCapital).toFixed(10)).toBe('26663706.4193548387')
      expect(analysis.periodReturn.returnDecimal.startsWith('0.006749211725')).toBe(true)
      expect(analysis.periodReturn.externalFlows).toHaveLength(2)
    }
    expect(exact(analysis.performance.cash.attribution?.fxValuationChange)).toBe('3077.6256')
    expect(analysis.performance.cash.attribution?.dividends).toBe('0.00')
    expect(analysis.performance.cash.attribution?.interest).toBe('0.00')
    expect(analysis.performance.cash.attribution?.fees).toBe('0.00')
    expect(analysis.performance.cash.attribution?.taxes).toBe('0.00')
    expect(exact(analysis.performance.cash.attribution?.otherCashResult)).toBe('5346.5904')
    expect(exact(analysis.performance.cash.attribution?.totalEconomicResult)).toBe('8424.2160')
    expect(
      new Decimal(analysis.performance.explainedResult ?? '0').eq(
        new Decimal(analysis.performance.breakdown.valuationChange).plus(
          analysis.performance.breakdown.cashEconomicResult ?? '0',
        ),
      ),
    ).toBe(true)
    expect(analysis.performance).not.toHaveProperty('roundingDifference')
    expect(analysis.performance).not.toHaveProperty('marketChange')

    expect(analysis.performance.positionResults).toHaveLength(25)
    expect(explainable(analysis)).toHaveLength(25)
    expect(pending(analysis)).toHaveLength(0)
    expect(
      analysis.performance.positionResults.filter(
        (position) => position.status === 'CORPORATE_ACTION_EXPLAINED',
      ),
    ).toHaveLength(1)

    for (const [ticker, change] of Object.entries(expectedChangeByTicker)) {
      expect(changeOf(analysis, tickerByInstrument, ticker), ticker).toBe(change)
    }

    expect(changeOf(analysis, tickerByInstrument, 'YPFD')).toBe('-4900.00')
    expect(statusOf(analysis, tickerByInstrument, 'YPFD')).toBe('CORPORATE_ACTION_EXPLAINED')

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
    for (const position of explainable(analysis)) {
      total = total.plus(position.valuationChange ?? '0')
    }

    expect(total.toFixed(2)).toBe(analysis.performance.breakdown.valuationChange)
    expect(total.toFixed(2)).toBe('171533.92')
  })

  it('suma la caja una sola vez y no vuelve a sumar el tipo de cambio', () => {
    const explained = new Decimal(analysis.performance.breakdown.valuationChange).plus(
      analysis.performance.breakdown.cashEconomicResult ?? '0',
    )

    expect(explained.eq(analysis.performance.explainedResult ?? '0')).toBe(true)
    expect(explained.plus(analysis.performance.cash.fxValuationChange).eq(explained)).toBe(false)
    expect(explained.eq(analysis.performance.cash.totalCashValueChange)).toBe(false)
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

  for (const balance of julyAugustCash.opening) {
    await snapshots.createCashBalance({
      snapshotId: opening.id,
      currency: balance.currency,
      amount: balance.amount,
      fxRate: balance.fxRate,
      valueInBaseCurrency: null,
    })
  }
  for (const balance of julyAugustCash.closing) {
    await snapshots.createCashBalance({
      snapshotId: closing.id,
      currency: balance.currency,
      amount: balance.amount,
      fxRate: balance.fxRate,
      valueInBaseCurrency: null,
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

  for (const dividend of julyAugustCableDividends) {
    const instrumentId = [...tickerByInstrument.entries()].find(
      ([, ticker]) => ticker === dividend.ticker,
    )?.[0]
    if (!instrumentId) throw new Error(`el fixture no creó ${dividend.ticker}`)
    await transactions.create({
      portfolioId: portfolio.id,
      periodId: august.id,
      instrumentId,
      date: dividend.date,
      type: 'DIVIDEND',
      quantity: null,
      unitPrice: null,
      grossAmount: null,
      netAmount: dividend.netAmount,
      fees: null,
      taxes: null,
      currency: 'USD_CABLE',
      fxRate: null,
      sourceDocumentId: null,
      sourceReference: null,
    })
  }

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

function exact(value: string | null | undefined): string {
  return new Decimal(value ?? '0').toFixed(4)
}

function mep(analysis: PeriodPerformanceAnalysis) {
  return analysis.performance.cash.balances.find((balance) => balance.currency === 'USD_MEP')
}

function cable(analysis: PeriodPerformanceAnalysis) {
  return analysis.performance.cash.balances.find((balance) => balance.currency === 'USD_CABLE')
}

function currencyAttribution(analysis: PeriodPerformanceAnalysis, currency: 'ARS' | 'USD_MEP' | 'USD_CABLE') {
  return analysis.performance.cash.currencyAttributions.find((item) => item.currency === currency)
}

function explainable(analysis: PeriodPerformanceAnalysis) {
  return analysis.performance.positionResults.filter(
    (position) =>
      position.status === 'EXPLAINED' || position.status === 'CORPORATE_ACTION_EXPLAINED',
  )
}

function pending(analysis: PeriodPerformanceAnalysis) {
  return analysis.performance.positionResults.filter(
    (position) =>
      position.status !== 'EXPLAINED' && position.status !== 'CORPORATE_ACTION_EXPLAINED',
  )
}

function statusOf(
  analysis: PeriodPerformanceAnalysis,
  tickerByInstrument: Map<EntityId, string>,
  ticker: string,
) {
  return analysis.performance.positionResults.find(
    (position) => tickerByInstrument.get(position.instrumentId) === ticker,
  )?.status
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
  return explainable(analysis)
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

  const corporateActions = explainable(analysis).filter(
    (position) => position.status === 'CORPORATE_ACTION_EXPLAINED',
  )
  const corporateLines = corporateActions.flatMap((position) => {
    const ticker = tickerByInstrument.get(position.instrumentId) ?? position.instrumentId
    return [
      ticker,
      'STOCK_DIVIDEND',
      `${position.openingQuantity} → ${position.closingQuantity}`,
      `valuationChange ${position.valuationChange}`,
    ]
  })

  return [
    'EXPECTED RESULT',
    analysis.performance.expectedResult,
    '',
    'POSITION VALUATION',
    analysis.performance.breakdown.valuationChange,
    '',
    'CASH ECONOMIC RESULT',
    analysis.performance.breakdown.cashEconomicResult,
    '',
    'EXPLICIT PERFORMANCE',
    new Decimal(analysis.performance.breakdown.dividends)
      .plus(analysis.performance.breakdown.interest)
      .minus(analysis.performance.breakdown.fees)
      .minus(analysis.performance.breakdown.taxes)
      .toFixed(2),
    '',
    'EXPLAINED',
    analysis.performance.explainedResult,
    '',
    'UNEXPLAINED',
    analysis.performance.unexplainedDifference,
    '',
    'POSITIONS EXPLAINED',
    String(explainable(analysis).length),
    '',
    'POSITIONS PENDING',
    String(pending(analysis).length),
    '',
    'PENDING:',
    ...(pendingLines.length === 0 ? ['—'] : pendingLines),
    '',
    'CORPORATE ACTIONS EXPLAINED',
    String(corporateActions.length),
    '',
    ...corporateLines,
    '',
    ...cashDiagnostic(analysis),
  ].join('\n')
}

function cashDiagnostic(analysis: PeriodPerformanceAnalysis): string[] {
  const mep = currencyAttribution(analysis, 'USD_MEP')
  const cable = currencyAttribution(analysis, 'USD_CABLE')
  const pesos = currencyAttribution(analysis, 'ARS')
  return [
    'USD_MEP',
    `Opening amount: ${mep?.openingAmount}`,
    `Closing amount: ${mep?.closingAmount}`,
    `Amount difference: ${mep?.amountDifference}`,
    `FX result: ${analysis.performance.cash.attribution?.fxValuationChange}`,
    `Amount status: ${mep?.amountStatus}`,
    `Attribution: ${mep?.attributionStatus}`,
    '',
    'USD_CABLE',
    `Opening amount: ${cable?.openingAmount}`,
    `Dividend inflows: ${cable?.dividendInflows}`,
    `Closing amount: ${cable?.closingAmount}`,
    `Amount difference: ${cable?.amountDifference}`,
    `Amount status: ${cable?.amountStatus}`,
    `ARS attribution: ${cable?.attributionStatus}`,
    '',
    'ARS',
    `Opening: ${pesos?.openingAmount}`,
    `Net external flows: ${analysis.performance.cash.externalNetFlows}`,
    `Closing: ${pesos?.closingAmount}`,
    `Residual: ${pesos?.amountDifference}`,
    `Amount status: ${pesos?.amountStatus}`,
    `Attribution: ${pesos?.attributionStatus}`,
  ]
}
