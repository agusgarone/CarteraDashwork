import { describe, expect, it } from 'vitest'
import type { EntityId } from '../domain/common'
import type { CurrencyCode } from '../domain/currency'
import type { PortfolioPeriod } from '../domain/period'
import type { PortfolioSnapshot } from '../domain/snapshot'
import type { Transaction, TransactionType } from '../domain/transaction'
import { aggregateExternalFlows } from './calculations/externalFlows'
import {
  calculateExpectedInvestmentResult,
  calculateNetContributions,
} from './calculations/investmentResult'
import {
  MissingClosingSnapshotError,
  MissingOpeningSnapshotError,
  MissingPeriodError,
  MissingTransactionAmountError,
} from './errors/analysisErrors'
import { createPeriodAnalysisService } from './services/periodAnalysisService'
import type { PeriodAnalysisRepositories } from './services/periodAnalysisService'

const OPENING = '25954029.00'
const CLOSING = '26383988.00'
const CONTRIBUTION = '1250000.00'
const WITHDRAWAL = '1000000.00'

describe('calculateNetContributions', () => {
  it('resta los retiros de los aportes', () => {
    expect(calculateNetContributions(CONTRIBUTION, WITHDRAWAL)).toBe('250000.00')
  })
})

describe('calculateExpectedInvestmentResult', () => {
  it('calcula el residual de julio a agosto 2026', () => {
    expect(
      calculateExpectedInvestmentResult({
        openingValue: OPENING,
        closingValue: CLOSING,
        contributions: CONTRIBUTION,
        withdrawals: WITHDRAWAL,
      }),
    ).toBe('179959.00')
  })

  it('conserva centavos que number redondea mal', () => {
    const asNumber = 110.3 - 100.1 - 5.05
    expect(asNumber.toString()).not.toBe('5.15')

    expect(
      calculateExpectedInvestmentResult({
        openingValue: '100.10',
        closingValue: '110.30',
        contributions: '5.05',
        withdrawals: '0',
      }),
    ).toBe('5.15')
  })
})

describe('aggregateExternalFlows', () => {
  it('suma solo CONTRIBUTION y WITHDRAWAL', () => {
    const flows = aggregateExternalFlows([
      movement('1', 'CONTRIBUTION', CONTRIBUTION),
      movement('2', 'WITHDRAWAL', WITHDRAWAL),
    ])

    expect(flows).toEqual({
      contributions: CONTRIBUTION,
      withdrawals: WITHDRAWAL,
      netContributions: '250000.00',
    })
  })

  it('no cuenta una compra como aporte', () => {
    const flows = aggregateExternalFlows([
      movement('1', 'CONTRIBUTION', CONTRIBUTION),
      movement('2', 'BUY', '1072440.00', { instrumentId: 'spy' }),
    ])

    expect(flows.contributions).toBe(CONTRIBUTION)
    expect(flows.contributions).not.toBe('2322440.00')
  })

  it('no cuenta una venta como retiro', () => {
    const flows = aggregateExternalFlows([
      movement('1', 'WITHDRAWAL', WITHDRAWAL),
      movement('2', 'SELL', '800000.00', { instrumentId: 'spy' }),
    ])

    expect(flows.withdrawals).toBe(WITHDRAWAL)
  })

  it('prioriza netAmount sobre grossAmount en un aporte', () => {
    const flows = aggregateExternalFlows([
      movement('1', 'CONTRIBUTION', '1000000.00', { netAmount: '999000.00' }),
    ])

    expect(flows.contributions).toBe('999000.00')
  })

  it('prioriza netAmount sobre grossAmount en un retiro', () => {
    const flows = aggregateExternalFlows([
      movement('1', 'WITHDRAWAL', '500000.00', { netAmount: '499500.00' }),
    ])

    expect(flows.withdrawals).toBe('499500.00')
  })

  it('usa grossAmount cuando el aporte no tiene neto', () => {
    const flows = aggregateExternalFlows([
      movement('1', 'CONTRIBUTION', '1250000.00', { netAmount: null }),
    ])

    expect(flows.contributions).toBe('1250000.00')
  })

  it('falla si el aporte no tiene neto ni bruto', () => {
    const incomplete = movement('1', 'CONTRIBUTION', '0.00', {
      grossAmount: null,
      netAmount: null,
    })

    expect(() => aggregateExternalFlows([incomplete])).toThrow(MissingTransactionAmountError)
  })

  it('no suma aportes de monedas distintas', () => {
    expect(() =>
      aggregateExternalFlows([
        movement('1', 'CONTRIBUTION', '10.00', { currency: 'ARS' }),
        movement('2', 'CONTRIBUTION', '5.00', { currency: 'USD_MEP' }),
      ]),
    ).toThrow(/una sola moneda/)
  })
})

describe('periodAnalysisService.analyzePeriod', () => {
  it('devuelve 179959.00 para agosto 2026 aunque haya compras y ventas', async () => {
    let openingBoundary = ''
    const repositories = fakeRepositories({
      onOpeningBoundary(date) {
        openingBoundary = date
      },
      transactions: [
        movement('1', 'CONTRIBUTION', CONTRIBUTION, { date: '2026-08-03' }),
        movement('2', 'WITHDRAWAL', WITHDRAWAL, { date: '2026-08-18' }),
        movement('3', 'BUY', '1072440.00', { date: '2026-08-10', instrumentId: 'spy' }),
        movement('4', 'SELL', '500000.00', { date: '2026-08-20', instrumentId: 'spy' }),
      ],
    })

    const result = await createPeriodAnalysisService(repositories).analyzePeriod('august')

    expect(openingBoundary).toBe('2026-08-01')
    expect(result).toEqual({
      openingValue: OPENING,
      closingValue: CLOSING,
      contributions: CONTRIBUTION,
      withdrawals: WITHDRAWAL,
      netContributions: '250000.00',
      investmentResult: '179959.00',
    })
  })

  it('falla si no hay snapshot de apertura', async () => {
    const repositories = fakeRepositories({ opening: null })

    await expect(createPeriodAnalysisService(repositories).analyzePeriod('august')).rejects.toBeInstanceOf(
      MissingOpeningSnapshotError,
    )
  })

  it('falla si no hay snapshot de cierre', async () => {
    const repositories = fakeRepositories({ closing: null })

    await expect(createPeriodAnalysisService(repositories).analyzePeriod('august')).rejects.toBeInstanceOf(
      MissingClosingSnapshotError,
    )
  })

  it('no convierte un aporte en otra moneda', async () => {
    const repositories = fakeRepositories({
      transactions: [movement('1', 'CONTRIBUTION', '10.00', { currency: 'USD_MEP' })],
    })

    await expect(createPeriodAnalysisService(repositories).analyzePeriod('august')).rejects.toThrow(
      /USD_MEP/,
    )
  })

  it('falla si el período no existe', async () => {
    const repositories = fakeRepositories({ period: null })

    await expect(createPeriodAnalysisService(repositories).analyzePeriod('august')).rejects.toBeInstanceOf(
      MissingPeriodError,
    )
  })
})

function movement(
  id: EntityId,
  type: TransactionType,
  amount: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    portfolioId: 'portfolio',
    periodId: 'august',
    instrumentId: null,
    date: '2026-08-03',
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
    createdAt: '2026-08-03 00:00:00',
    ...overrides,
  }
}

function snapshot(
  id: EntityId,
  periodId: EntityId,
  date: string,
  totalValue: string,
  currency: CurrencyCode = 'ARS',
): PortfolioSnapshot {
  return {
    id,
    portfolioId: 'portfolio',
    periodId,
    date,
    totalValue,
    currency,
    sourceDocumentId: null,
    createdAt: `${date} 00:00:00`,
  }
}

function augustPeriod(): PortfolioPeriod {
  return {
    id: 'august',
    portfolioId: 'portfolio',
    year: 2026,
    month: 8,
    status: 'COMPLETE',
    createdAt: '2026-08-01 00:00:00',
    completedAt: null,
  }
}

function fakeRepositories(options: {
  period?: PortfolioPeriod | null
  opening?: PortfolioSnapshot | null
  closing?: PortfolioSnapshot | null
  transactions?: Transaction[]
  onOpeningBoundary?: (date: string) => void
}): PeriodAnalysisRepositories {
  const period = options.period === undefined ? augustPeriod() : options.period
  const opening =
    options.opening === undefined
      ? snapshot('opening', 'july', '2026-07-31', OPENING)
      : options.opening
  const closing =
    options.closing === undefined
      ? snapshot('closing', 'august', '2026-08-31', CLOSING)
      : options.closing

  return {
    periods: {
      getById: async () => period,
    },
    snapshots: {
      getLatestBefore: async (_portfolioId, date) => {
        options.onOpeningBoundary?.(date)
        return opening
      },
      getLatestByPeriod: async () => closing,
    },
    transactions: {
      getByPeriod: async () => options.transactions ?? [],
    },
  }
}
