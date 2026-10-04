import { describe, expect, it } from 'vitest'
import type { Transaction, TransactionType } from '../domain/transaction'
import type { PortfolioSnapshot } from '../domain/snapshot'
import {
  calculateExplainedResult,
  calculateExplicitPerformanceBreakdown,
  reconcileExplicitPerformance,
} from './calculations/explicitPerformance'
import { MissingTransactionAmountError } from './errors/analysisErrors'
import { createPerformanceAnalysisService } from './services/performanceAnalysisService'

const ZERO = {
  dividends: '0.00',
  interest: '0.00',
  fees: '0.00',
  taxes: '0.00',
}

describe('calculateExplicitPerformanceBreakdown', () => {
  it('toma el bruto de un dividendo sin costos', () => {
    expect(breakdown(income('DIVIDEND', { grossAmount: '1000.00', netAmount: '1000.00' }))).toEqual({
      ...ZERO,
      dividends: '1000.00',
    })
  })

  it('separa bruto, comisión e impuesto de un dividendo', () => {
    const result = breakdown(
      income('DIVIDEND', {
        grossAmount: '1000.00',
        netAmount: '850.00',
        fees: '50.00',
        taxes: '100.00',
      }),
    )

    expect(result).toEqual({
      dividends: '1000.00',
      interest: '0.00',
      fees: '50.00',
      taxes: '100.00',
    })
    expect(calculateExplainedResult({ ...result, valuationChange: '0.00', cashEconomicResult: null })).toBe(
      '850.00',
    )
  })

  it('no vuelve a restar costos cuando el dividendo solo tiene neto', () => {
    const result = breakdown(
      income('DIVIDEND', {
        grossAmount: null,
        netAmount: '850.00',
        fees: '50.00',
        taxes: '100.00',
      }),
    )

    expect(result).toEqual({
      ...ZERO,
      dividends: '850.00',
    })
    expect(calculateExplainedResult({ ...result, valuationChange: '0.00', cashEconomicResult: null })).toBe(
      '850.00',
    )
    expect(
      calculateExplainedResult({ ...result, valuationChange: '0.00', cashEconomicResult: null }),
    ).not.toBe('700.00')
  })

  it('toma el bruto de un interés', () => {
    expect(breakdown(income('INTEREST', { grossAmount: '500.00', netAmount: '500.00' }))).toEqual({
      ...ZERO,
      interest: '500.00',
    })
  })

  it('suma una comisión independiente positiva', () => {
    expect(breakdown(cost('FEE', '200.00'))).toEqual({ ...ZERO, fees: '200.00' })
  })

  it('normaliza una comisión negativa a magnitud positiva', () => {
    expect(breakdown(cost('FEE', '-200.00'))).toEqual({ ...ZERO, fees: '200.00' })
  })

  it('suma un impuesto positivo', () => {
    expect(breakdown(cost('TAX', '30.00'))).toEqual({ ...ZERO, taxes: '30.00' })
  })

  it('normaliza un impuesto negativo a magnitud positiva', () => {
    expect(breakdown(cost('TAX', '-15.00'))).toEqual({ ...ZERO, taxes: '15.00' })
  })

  it('ignora una compra', () => {
    expect(breakdown(cost('BUY', '1072440.00'))).toEqual(ZERO)
  })

  it('ignora una venta', () => {
    expect(breakdown(cost('SELL', '430000.00'))).toEqual(ZERO)
  })

  it('ignora un aporte', () => {
    expect(breakdown(cost('CONTRIBUTION', '1250000.00'))).toEqual(ZERO)
  })

  it('ignora un retiro', () => {
    expect(breakdown(cost('WITHDRAWAL', '1000000.00'))).toEqual(ZERO)
  })

  it('falla si una comisión no tiene importe', () => {
    expect(() => breakdown(cost('FEE', '0.00', { grossAmount: null, netAmount: null }))).toThrow(
      MissingTransactionAmountError,
    )
  })

  it('falla si un impuesto no tiene importe', () => {
    expect(() => breakdown(cost('TAX', '0.00', { grossAmount: null, netAmount: null }))).toThrow(
      MissingTransactionAmountError,
    )
  })

  it('conserva centavos que number redondea mal', () => {
    const asNumber = 0.3 + 0.1 - 0.1 - 0.05
    expect(asNumber.toString()).not.toBe('0.25')

    const result = breakdown(
      income('DIVIDEND', { grossAmount: '0.30', netAmount: '0.30' }),
      income('INTEREST', { grossAmount: '0.10', netAmount: '0.10' }),
      cost('FEE', '0.10'),
      cost('TAX', '0.05'),
    )

    expect(calculateExplainedResult({ ...result, valuationChange: '0.00', cashEconomicResult: null })).toBe(
      '0.25',
    )
  })
})

describe('reconcileExplicitPerformance', () => {
  it('deja la diferencia pendiente fuera de la variación de mercado', () => {
    const result = reconcileExplicitPerformance({
      expectedResult: '179959.00',
      transactions: [
        income('DIVIDEND', { grossAmount: '1000.00', netAmount: '1000.00' }),
        income('INTEREST', { grossAmount: '500.00', netAmount: '500.00' }),
        cost('FEE', '100.00'),
        cost('TAX', '50.00'),
      ],
    })

    expect(result).toEqual({
      expectedResult: '179959.00',
      breakdown: {
        valuationChange: '0.00',
        cashEconomicResult: '0.00',
        dividends: '1000.00',
        interest: '500.00',
        fees: '100.00',
        taxes: '50.00',
      },
      positionResults: [],
      cash: {
        balances: [],
        openingCashValue: '0.00',
        closingCashValue: '0.00',
        totalCashValueChange: '0.00',
        externalNetFlows: '0.00',
        cashEconomicResult: '0.00',
        fxValuationChange: '0.00',
        attribution: {
          totalEconomicResult: '0.00',
          fxValuationChange: '0.00',
          dividends: '1000.00',
          interest: '500.00',
          fees: '100.00',
          taxes: '50.00',
          otherCashResult: '-1350.00',
        },
        currencyAttributions: [
          {
            currency: 'ARS',
            openingAmount: '0.00',
            closingAmount: '0.00',
            classifiedAmountChange: '1350.00',
            dividendInflows: '1000.00',
            amountDifference: '-1350.00',
            amountStatus: 'AMOUNT_MISMATCH',
            attributionStatus: 'BASE_CURRENCY',
          },
        ],
        status: 'EXPLAINED',
        reason: null,
      },
      explainedResult: '0.00',
      unexplainedDifference: '179959.00',
    })
    expect(result).not.toHaveProperty('marketChange')
  })
})

describe('performanceAnalysisService', () => {
  it('no convierte un movimiento explícito en otra moneda cuando la caja está invalidada', async () => {
    const closing = closingSnapshot()
    const opening = { ...closing, id: 'opening', date: '2026-07-31', periodId: 'july' }
    const service = createPerformanceAnalysisService({
      analysis: {
        analyzePeriod: async () => ({
          openingValue: '25954029.00',
          closingValue: '26383988.00',
          contributions: '1250000.00',
          withdrawals: '1000000.00',
          netContributions: '250000.00',
          investmentResult: '179959.00',
        }),
      },
      periods: {
        getById: async () => ({
          id: 'august',
          portfolioId: 'portfolio',
          year: 2026,
          month: 8,
          status: 'COMPLETE',
          createdAt: '2026-08-01 00:00:00',
          completedAt: null,
        }),
      },
      snapshots: {
        getLatestByPeriod: async () => closing,
        getLatestBefore: async () => opening,
        getAggregate: async (id) => ({
          snapshot: id === 'opening' ? opening : closing,
          positions: [],
          cashBalances: [],
        }),
      },
      transactions: {
        getByPeriod: async () => [
          cost('BUY', '10.00'),
          income('DIVIDEND', { currency: 'USD_MEP', grossAmount: '10.00' }),
        ],
      },
      corporateActions: {
        getByPeriod: async () => [],
      },
    })

    await expect(service.analyzePeriod('august')).rejects.toThrow(/USD_MEP/)
  })
})

function breakdown(...transactions: Transaction[]) {
  return calculateExplicitPerformanceBreakdown(transactions)
}

function income(
  type: 'DIVIDEND' | 'INTEREST',
  overrides: Partial<Transaction>,
): Transaction {
  return movement(type, '0.00', overrides)
}

function cost(
  type: TransactionType,
  amount: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return movement(type, amount, overrides)
}

function movement(
  type: TransactionType,
  amount: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: '1',
    portfolioId: 'portfolio',
    periodId: 'august',
    instrumentId: null,
    date: '2026-08-05',
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
    createdAt: '2026-08-05 00:00:00',
    ...overrides,
  }
}

function closingSnapshot(): PortfolioSnapshot {
  return {
    id: 'closing',
    portfolioId: 'portfolio',
    periodId: 'august',
    date: '2026-08-31',
    totalValue: '26383988.00',
    currency: 'ARS',
    sourceDocumentId: null,
    createdAt: '2026-08-31 00:00:00',
  }
}
