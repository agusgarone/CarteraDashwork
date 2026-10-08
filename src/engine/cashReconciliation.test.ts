import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { CurrencyCode } from '../domain/currency'
import type { CashBalance } from '../domain/snapshot'
import type { Transaction, TransactionType } from '../domain/transaction'
import { reconcileCash } from './calculations/cashReconciliation'
import { reconcileExplicitPerformance } from './calculations/explicitPerformance'
import { AnalysisError } from './errors/analysisErrors'
import { julyAugustCash } from './fixtures/julyAugust2026'

describe('reconcileCash', () => {
  it('deja el residual de la caja en pesos después de los flujos externos', () => {
    const result = reconcileCash({
      openingCashBalances: [balance('ARS', '17658.61', null)],
      closingCashBalances: [balance('ARS', '267659.33', null)],
      baseCurrency: 'ARS',
      netContributions: '250000.00',
      transactions: [],
    })

    expect(result.status).toBe('EXPLAINED')
    expect(result.balances).toEqual([
      {
        currency: 'ARS',
        openingAmount: '17658.61',
        closingAmount: '267659.33',
        openingFxRate: null,
        closingFxRate: null,
        openingValue: '17658.61',
        closingValue: '267659.33',
        valueChange: '250000.72',
        fxValuationChange: null,
        status: 'BASE_CURRENCY',
      },
    ])
    expect(result.cashEconomicResult).toBe('0.72')
  })

  it('atribuye el tipo de cambio cuando la cantidad en dólares no cambia', () => {
    const result = reconcileCash({
      openingCashBalances: [balance('USD_MEP', '100.00', '1000.00')],
      closingCashBalances: [balance('USD_MEP', '100.00', '1100.00')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [],
    })

    expect(result.balances[0]).toMatchObject({
      status: 'UNCHANGED_AMOUNT',
      openingValue: '100000.00',
      closingValue: '110000.00',
      valueChange: '10000.00',
      fxValuationChange: '10000.00',
    })
    expect(result.cashEconomicResult).toBe('10000.00')
  })

  it('trata iguales 100 y 100.0000 al medir el tipo de cambio', () => {
    const result = reconcileCash({
      openingCashBalances: [balance('USD_MEP', '100', '1000')],
      closingCashBalances: [balance('USD_MEP', '100.0000', '1100.00')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [],
    })

    expect(result.balances[0]?.status).toBe('UNCHANGED_AMOUNT')
    expect(result.balances[0]?.fxValuationChange).toBe('10000.00')
  })

  it('no etiqueta como tipo de cambio una moneda extranjera que aparece en el cierre', () => {
    const result = reconcileCash({
      openingCashBalances: [],
      closingCashBalances: [balance('USD_CABLE', '10.00', '1000.00')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [],
    })

    expect(result.balances[0]).toMatchObject({
      currency: 'USD_CABLE',
      openingAmount: '0.00',
      closingAmount: '10.00',
      openingFxRate: null,
      closingFxRate: '1000.00',
      openingValue: '0.00',
      closingValue: '10000.00',
      valueChange: '10000.00',
      fxValuationChange: null,
      status: 'AMOUNT_CHANGED',
    })
    expect(result.cashEconomicResult).toBe('10000.00')
  })

  it('suma varias monedas con la precisión del producto y resta los flujos ya calculados', () => {
    const result = reconcileCash({
      openingCashBalances: julyAugustCash.opening.map((item) =>
        balance(item.currency, item.amount, item.fxRate),
      ),
      closingCashBalances: julyAugustCash.closing.map((item) =>
        balance(item.currency, item.amount, item.fxRate),
      ),
      baseCurrency: 'ARS',
      netContributions: '250000.00',
      transactions: [movement('CONTRIBUTION'), movement('WITHDRAWAL')],
    })

    expect(result.status).toBe('EXPLAINED')
    expect(four(result.openingCashValue)).toBe('303958.8802')
    expect(four(result.closingCashValue)).toBe('562383.0962')
    expect(four(result.totalCashValueChange)).toBe('258424.2160')
    expect(result.externalNetFlows).toBe('250000.00')
    expect(four(result.cashEconomicResult)).toBe('8424.2160')
    expect(result.cashEconomicResult).not.toBe('8424.22')
    expect(four(result.fxValuationChange)).toBe('3077.6256')

    const mep = result.balances.find((item) => item.currency === 'USD_MEP')
    const cable = result.balances.find((item) => item.currency === 'USD_CABLE')
    const pesos = result.balances.find((item) => item.currency === 'ARS')
    expect(four(mep?.openingValue)).toBe('286300.2702')
    expect(four(mep?.closingValue)).toBe('289377.8958')
    expect(mep?.fxValuationChange).toBe(mep?.valueChange)
    expect(four(mep?.fxValuationChange)).toBe('3077.6256')
    expect(cable?.status).toBe('AMOUNT_CHANGED')
    expect(cable?.fxValuationChange).toBeNull()
    expect(four(cable?.closingValue)).toBe('5345.8704')
    expect(pesos?.valueChange).toBe('250000.72')
  })

  it('usa valueInBaseCurrency cuando coincide con amount × fxRate', () => {
    const result = reconcileCash({
      openingCashBalances: [balance('USD_MEP', '188.58', '1518.19', '286300.2702')],
      closingCashBalances: [balance('USD_MEP', '188.58', '1534.51', '289377.8958')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [],
    })

    expect(four(result.balances[0]?.openingValue)).toBe('286300.2702')
    expect(four(result.balances[0]?.fxValuationChange)).toBe('3077.6256')
  })

  it('no elige entre el valor persistido y amount × fxRate si difieren', () => {
    expect(() =>
      reconcileCash({
        openingCashBalances: [balance('USD_MEP', '188.58', '1518.19', '1.00')],
        closingCashBalances: [balance('USD_MEP', '188.58', '1518.19', '286300.2702')],
        baseCurrency: 'ARS',
        netContributions: '0.00',
        transactions: [],
      }),
    ).toThrow(AnalysisError)
  })

  it.each(['BUY', 'SELL', 'FUND_SUBSCRIPTION', 'FUND_REDEMPTION', 'FX_CONVERSION'] as const)(
    'invalida la caja simple ante %s',
    (type) => {
      const result = reconcileCash({
        openingCashBalances: [balance('ARS', '100.00', null)],
        closingCashBalances: [balance('ARS', '150.00', null)],
        baseCurrency: 'ARS',
        netContributions: '40.00',
        transactions: [movement(type)],
      })

      expect(result.status).toBe('HAS_INTERNAL_CASH_MOVEMENTS')
      expect(result.cashEconomicResult).toBeNull()
      expect(result.attribution).toBeNull()
      expect(result.totalCashValueChange).toBe('50.00')
    },
  )
})

describe('caja dentro del resultado explicado', () => {
  it('resta los flujos externos una sola vez y no suma el tipo de cambio aparte', () => {
    const result = reconcileExplicitPerformance({
      expectedResult: '179959.00',
      transactions: [],
      netContributions: '250000.00',
      baseCurrency: 'ARS',
      openingCashBalances: julyAugustCash.opening.map((item) =>
        balance(item.currency, item.amount, item.fxRate),
      ),
      closingCashBalances: julyAugustCash.closing.map((item) =>
        balance(item.currency, item.amount, item.fxRate),
      ),
    })

    expect(result.breakdown.dividends).toBe('0.00')
    expect(four(result.breakdown.cashEconomicResult)).toBe('8424.2160')
    expect(four(result.explainedResult)).toBe('8424.2160')
    expect(four(result.unexplainedDifference)).toBe('171534.7840')
    expect(result.explainedResult).not.toBe(result.cash.totalCashValueChange)
    expect(
      new Decimal(result.explainedResult ?? '0').eq(
        new Decimal(result.cash.cashEconomicResult ?? '0').plus(result.cash.fxValuationChange),
      ),
    ).toBe(false)
  })
})

function four(value: string | null | undefined): string {
  return new Decimal(value ?? '0').toFixed(4)
}

function balance(
  currency: CurrencyCode,
  amount: string,
  fxRate: string | null,
  valueInBaseCurrency: string | null = null,
): CashBalance {
  return {
    id: currency,
    snapshotId: 'snapshot',
    currency,
    amount,
    fxRate,
    valueInBaseCurrency,
  }
}

function movement(type: TransactionType): Transaction {
  return {
    id: type,
    portfolioId: 'portfolio',
    periodId: 'august',
    instrumentId: null,
    date: '2026-08-03',
    type,
    quantity: null,
    unitPrice: null,
    grossAmount: '1.00',
    netAmount: '1.00',
    fees: null,
    taxes: null,
    currency: 'ARS',
    fxRate: null,
    sourceDocumentId: null,
    sourceReference: null,
    createdAt: '2026-08-03 00:00:00',
  }
}
