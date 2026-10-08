import Decimal from 'decimal.js'
import { expect } from 'vitest'
import type { CurrencyCode } from '../domain/currency'
import type { PortfolioSnapshotAggregate } from '../domain/snapshot'
import { instrumentIdFromTicker } from './instrumentIdentity'
import type { ParsedPeriodAnalysis } from './analyzeParsedPeriod'

/** El motor no conserva el cero final de 8424.2160. El valor económico sí. */
function fourPlaces(value: string | null | undefined): string {
  return new Decimal(value ?? '0').toFixed(4)
}

export function expectPrintedSnapshots(analysis: ParsedPeriodAnalysis): void {
  expect(analysis.opening.snapshot.date).toBe('2026-07-31')
  expect(analysis.opening.snapshot.totalValue).toBe('25954029')
  expect(analysis.closing.snapshot.date).toBe('2026-08-31')
  expect(analysis.closing.snapshot.totalValue).toBe('26383988')
  expect(analysis.opening.snapshot.totalValue).not.toBe('25954030.8802')
  expect(analysis.closing.snapshot.totalValue).not.toBe('26383988.0962')

  expect(holding(analysis.opening, 'BCACCA')).toMatchObject({
    quantity: '14860.792493',
    unitPrice: '167.933481',
    marketValue: '2495624.61',
  })
  expect(holding(analysis.opening, 'BRTA')).toMatchObject({
    quantity: '3214.592773',
    unitPrice: '746.673907',
    marketValue: '2400252.55',
  })
  expect(holding(analysis.closing, 'BCACCA')).toMatchObject({
    quantity: '14860.792493',
    unitPrice: '153.944160',
    marketValue: '2287732.22',
  })
  expect(holding(analysis.closing, 'BRTA')).toMatchObject({
    quantity: '3214.592773',
    unitPrice: '742.458542',
    marketValue: '2386701.86',
  })
}

export function expectSignedMovements(analysis: ParsedPeriodAnalysis): void {
  expect(analysis.transactions.map((movement) => movement.type).sort()).toEqual(
    [
      'CONTRIBUTION',
      'DIVIDEND',
      'DIVIDEND',
      'DIVIDEND',
      'DIVIDEND',
      'DIVIDEND',
      'DIVIDEND',
      'DIVIDEND',
      'TAX',
      'WITHDRAWAL',
    ].sort(),
  )
  expect(movement(analysis, 'DIVIDEND', 'ARS', 'SPY')?.netAmount).toBe('-144.17')
  expect(movement(analysis, 'DIVIDEND', 'ARS', 'JPM')?.netAmount).toBe('-7.48')
  expect(movement(analysis, 'DIVIDEND', 'ARS', 'GGAL')?.netAmount).toBe('165.60')
  expect(movement(analysis, 'DIVIDEND', 'ARS', 'AAPL')?.netAmount).toBe('-1.61')
  expect(movement(analysis, 'TAX', 'ARS', 'GGAL')?.netAmount).toBe('-11.62')
  expect(movement(analysis, 'CONTRIBUTION', 'ARS', null)?.netAmount).toBe('1250000.00')
  expect(movement(analysis, 'WITHDRAWAL', 'ARS', null)?.netAmount).toBe('1000000.00')
  expect(movement(analysis, 'DIVIDEND', 'USD_CABLE', 'SPY')).toMatchObject({
    netAmount: '1.92',
    fxRate: null,
  })
  expect(movement(analysis, 'DIVIDEND', 'USD_CABLE', 'JPM')?.netAmount).toBe('1.17')
  expect(movement(analysis, 'DIVIDEND', 'USD_CABLE', 'AAPL')?.netAmount).toBe('0.25')

  expect(analysis.corporateActions).toEqual([
    expect.objectContaining({
      instrumentId: instrumentIdFromTicker('YPFD'),
      type: 'STOCK_DIVIDEND',
      quantityBefore: '14',
      quantityChange: '126',
      quantityAfter: '140',
    }),
  ])
  expect(holding(analysis.opening, 'YPFD')?.instrumentId).toBe(instrumentIdFromTicker('YPFD'))
  expect(holding(analysis.closing, 'YPFD')?.instrumentId).toBe(instrumentIdFromTicker('YPFD'))
}

export function expectCashBalances(analysis: ParsedPeriodAnalysis): void {
  expect(cash(analysis.opening, 'ARS')).toMatchObject({
    amount: '17658.61',
    fxRate: null,
    valueInBaseCurrency: '17658.61',
  })
  expect(cash(analysis.opening, 'USD_MEP')).toMatchObject({
    amount: '188.58',
    fxRate: '1518.19',
    valueInBaseCurrency: '286300.2702',
  })
  expect(cash(analysis.opening, 'USD_CABLE')).toMatchObject({
    amount: '0.00',
    fxRate: '1579.25',
    valueInBaseCurrency: '0',
  })
  expect(cash(analysis.closing, 'ARS')).toMatchObject({
    amount: '267659.33',
    fxRate: null,
    valueInBaseCurrency: '267659.33',
  })
  expect(cash(analysis.closing, 'USD_MEP')).toMatchObject({
    amount: '188.58',
    fxRate: '1534.51',
    valueInBaseCurrency: '289377.8958',
  })
  expect(cash(analysis.closing, 'USD_CABLE')).toMatchObject({
    amount: '3.34',
    fxRate: '1600.56',
    valueInBaseCurrency: '5345.8704',
  })
}

export function expectEngineResult(analysis: ParsedPeriodAnalysis): void {
  expect(analysis.flows.contributions).toBe('1250000.00')
  expect(analysis.flows.withdrawals).toBe('1000000.00')
  expect(analysis.investmentResult).toBe('179959.00')
  expect(analysis.performance.expectedResult).toBe('179959.00')

  const valuation = analysis.performance.positionResults.reduce(
    (total, position) => total.plus(position.valuationChange ?? '0'),
    new Decimal(0),
  )
  expect(analysis.performance.positionResults).toHaveLength(25)
  expect(valuation.toFixed(2)).toBe('171533.92')
  expect(analysis.performance.breakdown.valuationChange).toBe('171533.92')
  for (const position of analysis.performance.positionResults) {
    const quantityChanged = !new Decimal(position.openingQuantity ?? '0').eq(position.closingQuantity ?? '0')
    expect(position.status, position.instrumentId).toBe(
      quantityChanged ? 'CORPORATE_ACTION_EXPLAINED' : 'EXPLAINED',
    )
  }
  expect(analysis.performance.positionResults.find((position) => position.instrumentId === instrumentIdFromTicker('YPFD')))
    .toMatchObject({
      openingQuantity: '14',
      closingQuantity: '140',
      openingValue: '1160600.00',
      closingValue: '1155700.00',
      valuationChange: '-4900.00',
      status: 'CORPORATE_ACTION_EXPLAINED',
    })

  expect(fourPlaces(analysis.performance.cash.openingCashValue)).toBe('303958.8802')
  expect(fourPlaces(analysis.performance.cash.closingCashValue)).toBe('562383.0962')
  expect(fourPlaces(analysis.performance.cash.totalCashValueChange)).toBe('258424.2160')
  expect(analysis.performance.cash.externalNetFlows).toBe('250000.00')
  expect(fourPlaces(analysis.performance.cash.cashEconomicResult)).toBe('8424.2160')
  expect(fourPlaces(analysis.performance.breakdown.cashEconomicResult)).toBe('8424.2160')
  expect(fourPlaces(analysis.performance.explainedResult)).toBe('179958.1360')
  expect(fourPlaces(analysis.performance.unexplainedDifference)).toBe('0.8640')
  expect(analysis.performance.unexplainedDifference).not.toBe('0.00')
  expect(analysis.performance).not.toHaveProperty('roundingDifference')
}

export function expectCashReconciliation(analysis: ParsedPeriodAnalysis): void {
  expect(analysis.performance.cash.status).toBe('EXPLAINED')

  const pesos = attribution(analysis, 'ARS')
  const mep = attribution(analysis, 'USD_MEP')
  const cable = attribution(analysis, 'USD_CABLE')

  expect(pesos).toMatchObject({
    openingAmount: '17658.61',
    closingAmount: '267659.33',
    amountStatus: 'RECONCILED',
    attributionStatus: 'BASE_CURRENCY',
  })
  expect(fourPlaces(pesos?.classifiedAmountChange)).toBe('250000.7200')
  expect(fourPlaces(pesos?.amountDifference)).toBe('0.0000')

  expect(mep).toMatchObject({
    openingAmount: '188.58',
    closingAmount: '188.58',
    amountStatus: 'RECONCILED',
    attributionStatus: 'FX_ONLY',
  })
  expect(fourPlaces(mep?.amountDifference)).toBe('0.0000')
  expect(fourPlaces(analysis.performance.cash.balances.find((balance) => balance.currency === 'USD_MEP')?.fxValuationChange)).toBe(
    '3077.6256',
  )

  expect(cable).toMatchObject({
    openingAmount: '0.00',
    closingAmount: '3.34',
    amountStatus: 'RECONCILED',
    attributionStatus: 'MISSING_TRANSACTION_FX',
  })
  expect(fourPlaces(cable?.dividendInflows)).toBe('3.3400')
  expect(fourPlaces(cable?.amountDifference)).toBe('0.0000')
}

export function expectSourceIdentity(analysis: ParsedPeriodAnalysis): void {
  expect(analysis.openingDocumentDifference).toBe('1.8802')
  expect(analysis.closingDocumentDifference).toBe('0.0962')
  expect(fourPlaces(analysis.rawConsolidatedDifferenceChange)).toBe('1.7840')
  expect(analysis.sourceReconciliationDifference).toBe(analysis.rawConsolidatedDifferenceChange)
  expect(analysis.openingEnrichment.enrichedDetail.difference).toBe('1.0402')
  expect(analysis.closingEnrichment.enrichedDetail.difference).toBe('0.1762')
  expect(fourPlaces(analysis.enrichedDetailDifferenceChange)).toBe('0.8640')
  expect(analysis.enrichedDetailDifferenceChange).toBe(analysis.performance.unexplainedDifference)
  expect(analysis.rawConsolidatedDifferenceChange).not.toBe(analysis.enrichedDetailDifferenceChange)
  expect(analysis.openingEnrichment.warnings).toEqual([])
  expect(analysis.closingEnrichment.warnings).toEqual([])
  expect(analysis.openingEnrichment.position.reconciliation.difference).toBe('1.8802')
  expect(analysis.closingEnrichment.position.reconciliation.difference).toBe('0.0962')
}

export function expectNoDoubleCounting(analysis: ParsedPeriodAnalysis): void {
  const valuation = new Decimal(analysis.performance.breakdown.valuationChange)
  const cashEconomic = new Decimal(analysis.performance.breakdown.cashEconomicResult ?? '0')
  const explained = new Decimal(analysis.performance.explainedResult ?? '0')
  const countedAgain = valuation
    .plus(cashEconomic)
    .plus(analysis.performance.breakdown.dividends)
    .plus(analysis.performance.breakdown.interest)
    .minus(analysis.performance.breakdown.fees)
    .minus(analysis.performance.breakdown.taxes)

  expect(explained.eq(valuation.plus(cashEconomic))).toBe(true)
  expect(explained.toFixed(4)).toBe('179958.1360')
  expect(countedAgain.eq(explained)).toBe(false)
}

function holding(snapshot: PortfolioSnapshotAggregate, ticker: string) {
  return snapshot.positions.find((position) => position.instrumentId === instrumentIdFromTicker(ticker))
}

function cash(snapshot: PortfolioSnapshotAggregate, currency: CurrencyCode) {
  return snapshot.cashBalances.find((balance) => balance.currency === currency)
}

function movement(
  analysis: ParsedPeriodAnalysis,
  type: string,
  currency: CurrencyCode,
  ticker: string | null,
) {
  const instrumentId = ticker === null ? null : instrumentIdFromTicker(ticker)
  return analysis.transactions.find(
    (item) => item.type === type && item.currency === currency && item.instrumentId === instrumentId,
  )
}

function attribution(analysis: ParsedPeriodAnalysis, currency: CurrencyCode) {
  return analysis.performance.cash.currencyAttributions.find((item) => item.currency === currency)
}
