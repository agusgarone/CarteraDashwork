import type { DecimalString } from '../../domain/common'
import type { CorporateAction } from '../../domain/corporateAction'
import type { CurrencyCode } from '../../domain/currency'
import type { Position } from '../../domain/snapshot'
import type { Transaction, TransactionType } from '../../domain/transaction'
import { AnalysisError, MissingTransactionAmountError } from '../errors/analysisErrors'
import { formatMonetary, parseDecimal, zeroDecimal } from '../money'
import type {
  ExplicitPerformanceBreakdown,
  PerformanceBreakdown,
  PerformanceReconciliationResult,
} from '../models/explicitPerformance'
import {
  analyzePositionValuations,
  calculateTotalValuationChange,
} from './positionValuation'

export interface ExplicitPerformanceInput {
  expectedResult: DecimalString
  transactions: readonly Transaction[]
  openingPositions?: readonly Position[]
  closingPositions?: readonly Position[]
  corporateActions?: readonly CorporateAction[]
  currency?: CurrencyCode
}

/**
 * Atribuye dividendos, intereses, comisiones e impuestos.
 * El resto del resultado esperado queda fuera de este desglose.
 *
 * DIVIDEND e INTEREST: si hay grossAmount, ese es el ingreso y los
 * fees/taxes de la misma fila se cuentan aparte. Si solo hay netAmount,
 * el neto ya puede incluir esos costos, así que el ingreso es el neto y
 * no se vuelven a restar. Una fila FEE o TAX separada se suma igual:
 * el engine no decide si es el mismo costo embebido en otro movimiento.
 * Esa deduplicación le corresponde al parser.
 */
export function calculateExplicitPerformanceBreakdown(
  transactions: readonly Transaction[],
): ExplicitPerformanceBreakdown {
  let dividends = zeroDecimal()
  let interest = zeroDecimal()
  let fees = zeroDecimal()
  let taxes = zeroDecimal()
  let currency: CurrencyCode | null = null

  for (const transaction of transactions) {
    if (!isExplicitPerformance(transaction.type)) continue

    if (currency === null) {
      currency = transaction.currency
    } else if (currency !== transaction.currency) {
      throw new AnalysisError(
        'Los dividendos, intereses, comisiones e impuestos del período no están en una sola moneda.',
      )
    }

    if (transaction.type === 'DIVIDEND' || transaction.type === 'INTEREST') {
      const income = attributeIncome(transaction)
      if (transaction.type === 'DIVIDEND') dividends = dividends.plus(income.amount)
      else interest = interest.plus(income.amount)
      fees = fees.plus(income.fees)
      taxes = taxes.plus(income.taxes)
      continue
    }

    const cost = standaloneCost(transaction)
    if (transaction.type === 'FEE') fees = fees.plus(cost)
    else taxes = taxes.plus(cost)
  }

  return {
    dividends: formatMonetary(dividends),
    interest: formatMonetary(interest),
    fees: formatMonetary(fees),
    taxes: formatMonetary(taxes),
  }
}

/** valuationChange + dividends + interest − fees − taxes */
export function calculateExplainedResult(breakdown: PerformanceBreakdown): DecimalString {
  const explained = parseDecimal(breakdown.valuationChange)
    .plus(breakdown.dividends)
    .plus(breakdown.interest)
    .minus(breakdown.fees)
    .minus(breakdown.taxes)
  return formatMonetary(explained)
}

/** expectedResult − explainedResult. No se fuerza a cero y no es marketChange. */
export function calculateUnexplainedDifference(
  expectedResult: DecimalString,
  explainedResult: DecimalString,
): DecimalString {
  const difference = parseDecimal(expectedResult).minus(parseDecimal(explainedResult))
  return formatMonetary(difference)
}

export function reconcileExplicitPerformance(
  input: ExplicitPerformanceInput,
): PerformanceReconciliationResult {
  const openingPositions = input.openingPositions ?? []
  const closingPositions = input.closingPositions ?? []
  const positionResults =
    openingPositions.length === 0 && closingPositions.length === 0
      ? []
      : analyzePositionValuations({
          openingPositions,
          closingPositions,
          transactions: input.transactions,
          corporateActions: input.corporateActions ?? [],
          currency: requiredCurrency(input.currency),
        })
  const explicit = calculateExplicitPerformanceBreakdown(input.transactions)
  const breakdown: PerformanceBreakdown = {
    valuationChange: calculateTotalValuationChange(positionResults),
    dividends: explicit.dividends,
    interest: explicit.interest,
    fees: explicit.fees,
    taxes: explicit.taxes,
  }
  const explainedResult = calculateExplainedResult(breakdown)
  return {
    expectedResult: formatMonetary(parseDecimal(input.expectedResult)),
    breakdown,
    positionResults,
    explainedResult,
    unexplainedDifference: calculateUnexplainedDifference(input.expectedResult, explainedResult),
  }
}

function requiredCurrency(currency: CurrencyCode | undefined): CurrencyCode {
  if (currency === undefined) {
    throw new AnalysisError('Falta la moneda del cierre para valuar posiciones.')
  }
  return currency
}

function isExplicitPerformance(
  type: TransactionType,
): type is 'DIVIDEND' | 'INTEREST' | 'FEE' | 'TAX' {
  return type === 'DIVIDEND' || type === 'INTEREST' || type === 'FEE' || type === 'TAX'
}

function attributeIncome(transaction: Transaction) {
  if (transaction.grossAmount !== null) {
    return {
      amount: parseDecimal(transaction.grossAmount),
      fees: positiveMagnitude(transaction.fees),
      taxes: positiveMagnitude(transaction.taxes),
    }
  }

  if (transaction.netAmount !== null) {
    return {
      amount: parseDecimal(transaction.netAmount),
      fees: zeroDecimal(),
      taxes: zeroDecimal(),
    }
  }

  throw new MissingTransactionAmountError(transaction.id, transaction.type)
}

function standaloneCost(transaction: Transaction) {
  const amount = transaction.netAmount ?? transaction.grossAmount
  if (amount === null) {
    throw new MissingTransactionAmountError(transaction.id, transaction.type)
  }
  return parseDecimal(amount).abs()
}

function positiveMagnitude(value: DecimalString | null) {
  if (value === null) return zeroDecimal()
  return parseDecimal(value).abs()
}
