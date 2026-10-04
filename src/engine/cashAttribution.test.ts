import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { CurrencyCode } from '../domain/currency'
import type { CashBalance } from '../domain/snapshot'
import type { Transaction, TransactionType } from '../domain/transaction'
import { reconcileCash } from './calculations/cashReconciliation'
import { reconcileExplicitPerformance } from './calculations/explicitPerformance'
import type { CashAttributionBreakdown } from './models/cashReconciliation'
import { julyAugustCash } from './fixtures/julyAugust2026'

describe('atribución de caja', () => {
  it('clasifica el tipo de cambio de un saldo extranjero que no cambia de cantidad', () => {
    const result = reconcileCash({
      openingCashBalances: [cash('USD_MEP', '188.58', '1518.19')],
      closingCashBalances: [cash('USD_MEP', '188.58', '1534.51')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [],
    })

    expect(result.currencyAttributions[0]?.amountStatus).toBe('RECONCILED')
    expect(result.currencyAttributions[0]?.attributionStatus).toBe('FX_ONLY')
    expect(four(result.attribution?.fxValuationChange)).toBe('3077.6256')
    expect(result.attribution?.dividends).toBe('0.00')
    expect(closes(result.attribution)).toBe(true)
  })

  it('separa el dividendo al tipo de cambio de cobro y el ajuste posterior', () => {
    const result = reconcileCash({
      openingCashBalances: [],
      closingCashBalances: [cash('USD_CABLE', '10.00', '1100.00')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [dividend('USD_CABLE', '10.00', '1000.00')],
    })

    expect(result.currencyAttributions[0]?.amountStatus).toBe('RECONCILED')
    expect(result.currencyAttributions[0]?.attributionStatus).toBe('CLASSIFIED')
    expect(four(result.attribution?.dividends)).toBe('10000.0000')
    expect(four(result.attribution?.fxValuationChange)).toBe('1000.0000')
    expect(four(result.attribution?.otherCashResult)).toBe('0.0000')
    expect(four(result.attribution?.totalEconomicResult)).toBe('11000.0000')
    expect(four(result.closingCashValue)).toBe('11000.0000')
    expect(result.cashEconomicResult).toBe(result.attribution?.totalEconomicResult)
    expect(closes(result.attribution)).toBe(true)
  })

  it('suma el tipo de cambio del saldo anterior y el del dividendo nuevo', () => {
    const result = reconcileCash({
      openingCashBalances: [cash('USD_MEP', '100.00', '900.00')],
      closingCashBalances: [cash('USD_MEP', '110.00', '1100.00')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [dividend('USD_MEP', '10.00', '1000.00')],
    })

    expect(four(result.attribution?.fxValuationChange)).toBe('21000.0000')
    expect(four(result.attribution?.dividends)).toBe('10000.0000')
    expect(four(result.attribution?.totalEconomicResult)).toBe('31000.0000')
    expect(four(result.attribution?.otherCashResult)).toBe('0.0000')
    expect(result.currencyAttributions[0]?.amountStatus).toBe('RECONCILED')
    expect(result.currencyAttributions[0]?.attributionStatus).toBe('CLASSIFIED')
    expect(closes(result.attribution)).toBe(true)
  })

  it('deja en other el dividendo extranjero que no trae tipo de cambio', () => {
    const result = reconcileCash({
      openingCashBalances: [],
      closingCashBalances: [cash('USD_CABLE', '10.00', '1100.00')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [dividend('USD_CABLE', '10.00', null)],
    })

    expect(result.currencyAttributions[0]?.amountStatus).toBe('RECONCILED')
    expect(result.currencyAttributions[0]?.attributionStatus).toBe('MISSING_TRANSACTION_FX')
    expect(result.attribution?.dividends).toBe('0.00')
    expect(result.attribution?.fxValuationChange).toBe('0.00')
    expect(four(result.attribution?.otherCashResult)).toBe('11000.0000')
    expect(four(result.cashEconomicResult)).toBe('11000.0000')
    expect(closes(result.attribution)).toBe(true)
  })

  it('reconcilia 3.34 USD Cable con tres dividendos y deja la atribución en pesos pendiente', () => {
    const result = reconcileCash({
      openingCashBalances: [cash('USD_CABLE', '0.00', '1579.25')],
      closingCashBalances: [cash('USD_CABLE', '3.34', '1600.56')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [
        netDividend('USD_CABLE', '1.92'),
        netDividend('USD_CABLE', '1.17'),
        netDividend('USD_CABLE', '0.25'),
      ],
    })

    const cable = result.currencyAttributions[0]
    expect(four(cable?.dividendInflows)).toBe('3.3400')
    expect(four(cable?.classifiedAmountChange)).toBe('3.3400')
    expect(four(cable?.amountDifference)).toBe('0.0000')
    expect(cable?.amountStatus).toBe('RECONCILED')
    expect(cable?.attributionStatus).toBe('MISSING_TRANSACTION_FX')
    expect(result.attribution?.dividends).toBe('0.00')
    expect(four(result.closingCashValue)).toBe('5345.8704')
    expect(four(result.cashEconomicResult)).toBe('5345.8704')
    expect(four(result.attribution?.otherCashResult)).toBe('5345.8704')
    expect(closes(result.attribution)).toBe(true)
  })

  it('no absorbe una diferencia de un centavo de dólar', () => {
    const result = reconcileCash({
      openingCashBalances: [cash('USD_CABLE', '0.00', null)],
      closingCashBalances: [cash('USD_CABLE', '3.35', '1600.56')],
      baseCurrency: 'ARS',
      netContributions: '0.00',
      transactions: [
        netDividend('USD_CABLE', '1.92'),
        netDividend('USD_CABLE', '1.17'),
        netDividend('USD_CABLE', '0.25'),
      ],
    })

    expect(four(result.currencyAttributions[0]?.amountDifference)).toBe('0.0100')
    expect(result.currencyAttributions[0]?.amountStatus).toBe('AMOUNT_MISMATCH')
    expect(result.currencyAttributions[0]?.attributionStatus).toBe('MISSING_TRANSACTION_FX')
  })

  it('reconcilia la cantidad en pesos con aportes y retiros y deja el residual sin etiquetar', () => {
    const result = reconcileCash({
      openingCashBalances: [cash('ARS', '17658.61', null)],
      closingCashBalances: [cash('ARS', '267659.33', null)],
      baseCurrency: 'ARS',
      netContributions: '250000.00',
      transactions: [
        external('CONTRIBUTION', '1250000.00'),
        external('WITHDRAWAL', '1000000.00'),
      ],
    })

    const pesos = result.currencyAttributions[0]
    expect(pesos?.amountStatus).toBe('AMOUNT_MISMATCH')
    expect(pesos?.attributionStatus).toBe('BASE_CURRENCY')
    expect(four(pesos?.classifiedAmountChange)).toBe('250000.0000')
    expect(four(pesos?.amountDifference)).toBe('0.7200')
    expect(result.attribution?.dividends).toBe('0.00')
    expect(result.attribution?.interest).toBe('0.00')
    expect(four(result.attribution?.otherCashResult)).toBe('0.7200')
    expect(four(result.cashEconomicResult)).toBe('0.7200')
    expect(closes(result.attribution)).toBe(true)
  })

  it('no vuelve a sumar la descomposición encima del resultado de caja', () => {
    const result = reconcileExplicitPerformance({
      expectedResult: '179959.00',
      transactions: [dividend('ARS', '1000.00', null)],
      netContributions: '250000.00',
      baseCurrency: 'ARS',
      openingCashBalances: julyAugustCash.opening.map((item) => cash(item.currency, item.amount, item.fxRate)),
      closingCashBalances: julyAugustCash.closing.map((item) => cash(item.currency, item.amount, item.fxRate)),
    })

    expect(four(result.breakdown.cashEconomicResult)).toBe('8424.2160')
    expect(result.explainedResult).toBe(result.breakdown.cashEconomicResult)
    expect(four(result.breakdown.dividends)).toBe('1000.0000')
    expect(
      new Decimal(result.explainedResult).eq(
        new Decimal(result.breakdown.cashEconomicResult ?? '0').plus(result.breakdown.dividends),
      ),
    ).toBe(false)
    expect(
      new Decimal(result.explainedResult).eq(
        new Decimal(result.breakdown.cashEconomicResult ?? '0').plus(
          result.cash.attribution?.fxValuationChange ?? '0',
        ),
      ),
    ).toBe(false)
    expect(closes(result.cash.attribution)).toBe(true)
  })

  it('mantiene la identidad del fixture real y no mueve el resultado global', () => {
    const result = reconcileExplicitPerformance({
      expectedResult: '179959.00',
      transactions: [
        external('CONTRIBUTION', '1250000.00'),
        external('WITHDRAWAL', '1000000.00'),
      ],
      netContributions: '250000.00',
      baseCurrency: 'ARS',
      openingCashBalances: julyAugustCash.opening.map((item) => cash(item.currency, item.amount, item.fxRate)),
      closingCashBalances: julyAugustCash.closing.map((item) => cash(item.currency, item.amount, item.fxRate)),
    })

    expect(four(result.cash.attribution?.totalEconomicResult)).toBe('8424.2160')
    expect(four(result.cash.attribution?.fxValuationChange)).toBe('3077.6256')
    expect(result.cash.attribution?.dividends).toBe('0.00')
    expect(result.cash.attribution?.interest).toBe('0.00')
    expect(result.cash.attribution?.fees).toBe('0.00')
    expect(result.cash.attribution?.taxes).toBe('0.00')
    expect(four(result.cash.attribution?.otherCashResult)).toBe('5346.5904')
    expect(result.cash.currencyAttributions.find((item) => item.currency === 'USD_MEP')?.attributionStatus).toBe(
      'FX_ONLY',
    )
    expect(result.cash.currencyAttributions.find((item) => item.currency === 'USD_MEP')?.amountStatus).toBe(
      'RECONCILED',
    )
    expect(result.cash.currencyAttributions.find((item) => item.currency === 'USD_CABLE')?.amountStatus).toBe(
      'AMOUNT_MISMATCH',
    )
    expect(result.cash.currencyAttributions.find((item) => item.currency === 'USD_CABLE')?.attributionStatus).toBe(
      'UNCLASSIFIED',
    )
    expect(closes(result.cash.attribution)).toBe(true)
    expect(result.explainedResult).toBe(result.breakdown.cashEconomicResult)
    expect(four(result.unexplainedDifference)).toBe('171534.7840')
  })
})

function closes(attribution: CashAttributionBreakdown | null): boolean {
  if (attribution === null) return false
  const total = new Decimal(attribution.fxValuationChange)
    .plus(attribution.dividends)
    .plus(attribution.interest)
    .minus(attribution.fees)
    .minus(attribution.taxes)
    .plus(attribution.otherCashResult)
  return total.eq(attribution.totalEconomicResult)
}

function four(value: string | null | undefined): string {
  return new Decimal(value ?? '0').toFixed(4)
}

function cash(currency: CurrencyCode, amount: string, fxRate: string | null): CashBalance {
  return {
    id: currency,
    snapshotId: 'snapshot',
    currency,
    amount,
    fxRate,
    valueInBaseCurrency: null,
  }
}

function netDividend(currency: CurrencyCode, amount: string): Transaction {
  return {
    ...movement('DIVIDEND', amount, currency, null),
    grossAmount: null,
  }
}

function dividend(currency: CurrencyCode, amount: string, fxRate: string | null): Transaction {
  return movement('DIVIDEND', amount, currency, fxRate)
}

function external(type: 'CONTRIBUTION' | 'WITHDRAWAL', amount: string): Transaction {
  return movement(type, amount, 'ARS', null)
}

function movement(
  type: TransactionType,
  amount: string,
  currency: CurrencyCode,
  fxRate: string | null,
): Transaction {
  return {
    id: type,
    portfolioId: 'portfolio',
    periodId: 'august',
    instrumentId: null,
    date: '2026-08-10',
    type,
    quantity: null,
    unitPrice: null,
    grossAmount: amount,
    netAmount: amount,
    fees: null,
    taxes: null,
    currency,
    fxRate,
    sourceDocumentId: null,
    sourceReference: null,
    createdAt: '2026-08-10 00:00:00',
  }
}
