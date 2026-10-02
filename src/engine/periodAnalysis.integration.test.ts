import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import type { CreateTransactionInput } from '../repositories/transactionRepository'
import type { TransactionType } from '../domain/transaction'
import { createPerformanceAnalysisService } from './services/performanceAnalysisService'
import { createPeriodAnalysisService } from './services/periodAnalysisService'

describe('análisis de agosto contra SQLite', () => {
  let closeDatabase: (() => void) | undefined

  afterEach(() => {
    closeDatabase?.()
    closeDatabase = undefined
  })

  it('recorre repositories reales y devuelve 179959.00', async () => {
    const database = openMemoryDatabase()
    closeDatabase = database.close
    const seeded = await seedAugust(database.client)

    const opening = await seeded.snapshots.getLatestBefore(seeded.portfolio.id, '2026-08-01')
    const closing = await seeded.snapshots.getLatestByPeriod(seeded.august.id)
    const periodTransactions = await seeded.transactions.getByPeriod(seeded.august.id)

    expect(opening?.date).toBe('2026-07-31')
    expect(closing?.date).toBe('2026-08-31')
    expect(periodTransactions.map((transaction) => transaction.type)).toEqual([
      'CONTRIBUTION',
      'BUY',
      'WITHDRAWAL',
      'SELL',
    ])

    const result = await seeded.analysis.analyzePeriod(seeded.august.id)

    expect(result).toEqual({
      openingValue: '25954029.00',
      closingValue: '26383988.00',
      contributions: '1250000.00',
      withdrawals: '1000000.00',
      netContributions: '250000.00',
      investmentResult: '179959.00',
    })
  })

  it('explica dividendos, intereses, comisiones e impuestos sin cambiar el residual', async () => {
    const database = openMemoryDatabase()
    closeDatabase = database.close

    const seeded = await seedAugust(database.client)
    await seeded.transactions.create(
      cashMovement(seeded.portfolio.id, seeded.august.id, '2026-08-05', 'DIVIDEND', '1000.00'),
    )
    await seeded.transactions.create(
      cashMovement(seeded.portfolio.id, seeded.august.id, '2026-08-12', 'INTEREST', '500.00'),
    )
    await seeded.transactions.create(
      cashMovement(seeded.portfolio.id, seeded.august.id, '2026-08-15', 'FEE', '100.00'),
    )
    await seeded.transactions.create(
      cashMovement(seeded.portfolio.id, seeded.august.id, '2026-08-25', 'TAX', '50.00'),
    )

    const opening = await seeded.snapshots.getLatestBefore(seeded.portfolio.id, '2026-08-01')
    const closing = await seeded.snapshots.getLatestByPeriod(seeded.august.id)
    if (!opening || !closing) throw new Error('faltan los snapshots de julio o agosto')

    const meta = await seeded.instruments.create(instrument('META'))
    const aapl = await seeded.instruments.create(instrument('AAPL'))
    const amzn = await seeded.instruments.create(instrument('AMZN'))
    const ypf = await seeded.instruments.create(instrument('YPF'))

    await holding(seeded.snapshots, opening.id, meta.id, '13', '475020.00')
    await holding(seeded.snapshots, closing.id, meta.id, '13', '496340.00')
    await holding(seeded.snapshots, opening.id, aapl.id, '28', '680680.00')
    await holding(seeded.snapshots, closing.id, aapl.id, '28', '708960.00')
    await holding(seeded.snapshots, opening.id, amzn.id, '353', '1051058.00')
    await holding(seeded.snapshots, closing.id, amzn.id, '353', '1021935.00')
    await holding(seeded.snapshots, opening.id, ypf.id, '14', '1160600.00')
    await holding(seeded.snapshots, closing.id, ypf.id, '140', '1155700.00')
    await seeded.snapshots.createCashBalance({
      snapshotId: closing.id,
      currency: 'ARS',
      amount: '999.00',
      fxRate: null,
      valueInBaseCurrency: null,
    })

    const corporateActions = createCorporateActionRepository(database.client)
    await corporateActions.create({
      portfolioId: seeded.portfolio.id,
      periodId: seeded.august.id,
      instrumentId: ypf.id,
      date: '2026-08-20',
      type: 'STOCK_DIVIDEND',
      quantityBefore: '14',
      quantityChange: '126',
      quantityAfter: '140',
      ratio: null,
      description: null,
      sourceDocumentId: null,
    })

    const performance = createPerformanceAnalysisService({
      analysis: seeded.analysis,
      periods: createPeriodRepository(database.client),
      snapshots: seeded.snapshots,
      transactions: seeded.transactions,
      corporateActions,
    })
    const result = await performance.analyzePeriod(seeded.august.id)
    const byInstrument = new Map(
      result.performance.positionResults.map((position) => [position.instrumentId, position]),
    )

    expect(result.base.investmentResult).toBe('179959.00')
    expect(byInstrument.get(meta.id)).toMatchObject({
      status: 'EXPLAINED',
      valuationChange: '21320.00',
    })
    expect(byInstrument.get(aapl.id)).toMatchObject({
      status: 'EXPLAINED',
      valuationChange: '28280.00',
    })
    expect(byInstrument.get(amzn.id)).toMatchObject({
      status: 'EXPLAINED',
      valuationChange: '-29123.00',
    })
    expect(byInstrument.get(ypf.id)).toMatchObject({
      status: 'HAS_CORPORATE_ACTION',
      valuationChange: null,
    })
    expect(result.performance.positionResults).toHaveLength(4)
    expect(result.performance.breakdown.valuationChange).toBe('20477.00')
    expect(result.performance).toEqual({
      expectedResult: '179959.00',
      breakdown: {
        valuationChange: '20477.00',
        dividends: '1000.00',
        interest: '500.00',
        fees: '100.00',
        taxes: '50.00',
      },
      positionResults: result.performance.positionResults,
      explainedResult: '21827.00',
      unexplainedDifference: '158132.00',
    })
    expect(result.performance).not.toHaveProperty('marketChange')
    expect(result.performance.breakdown).not.toHaveProperty('marketChange')
  })
})

async function seedAugust(client: Parameters<typeof createPortfolioRepository>[0]) {
  const portfolios = createPortfolioRepository(client)
  const periods = createPeriodRepository(client)
  const snapshots = createSnapshotRepository(client)
  const transactions = createTransactionRepository(client)
  const instruments = createInstrumentRepository(client)
  const analysis = createPeriodAnalysisService({ periods, snapshots, transactions })

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

  await snapshots.createSnapshot({
    portfolioId: portfolio.id,
    periodId: july.id,
    date: '2026-07-31',
    totalValue: '25954029.00',
    currency: 'ARS',
    sourceDocumentId: null,
  })
  await snapshots.createSnapshot({
    portfolioId: portfolio.id,
    periodId: august.id,
    date: '2026-08-31',
    totalValue: '26383988.00',
    currency: 'ARS',
    sourceDocumentId: null,
  })

  const spy = await instruments.create({
    ticker: 'SPY',
    name: 'SPDR S&P 500',
    category: 'CEDEAR',
    currency: 'ARS',
    brokerIdentifier: null,
  })

  await transactions.create(
    cashMovement(portfolio.id, august.id, '2026-08-03', 'CONTRIBUTION', '1250000.00'),
  )
  await transactions.create(
    cashMovement(portfolio.id, august.id, '2026-08-18', 'WITHDRAWAL', '1000000.00'),
  )
  await transactions.create({
    ...cashMovement(portfolio.id, august.id, '2026-08-10', 'BUY', '1072440.00'),
    instrumentId: spy.id,
  })
  await transactions.create({
    ...cashMovement(portfolio.id, august.id, '2026-08-21', 'SELL', '430000.00'),
    instrumentId: spy.id,
  })

  return { portfolio, august, snapshots, transactions, instruments, analysis }
}

function instrument(ticker: string) {
  return {
    ticker,
    name: ticker,
    category: 'CEDEAR' as const,
    currency: 'ARS' as const,
    brokerIdentifier: null,
  }
}

function holding(
  snapshots: ReturnType<typeof createSnapshotRepository>,
  snapshotId: string,
  instrumentId: string,
  quantity: string,
  marketValue: string,
) {
  return snapshots.createPosition({
    snapshotId,
    instrumentId,
    quantity,
    unitPrice: '1.00',
    marketValue,
    currency: 'ARS',
  })
}

function cashMovement(
  portfolioId: string,
  periodId: string,
  date: string,
  type: TransactionType,
  amount: string,
): CreateTransactionInput {
  return {
    portfolioId,
    periodId,
    instrumentId: null,
    date,
    type,
    quantity: null,
    unitPrice: null,
    grossAmount: amount,
    netAmount: amount,
    fees: null,
    taxes: null,
    currency: 'ARS',
    fxRate: null,
    sourceDocumentId: null,
    sourceReference: null,
  }
}
