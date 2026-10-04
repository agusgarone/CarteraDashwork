import type Decimal from 'decimal.js'
import type { CurrencyCode } from '../../domain/currency'
import type { Transaction, TransactionType } from '../../domain/transaction'
import { MissingTransactionAmountError } from '../errors/analysisErrors'
import { formatExact, parseDecimal, zeroDecimal } from '../money'
import type {
  CashAttributionBreakdown,
  CashCurrencyAttribution,
} from '../models/cashReconciliation'
import { resolveExternalFlowAmount } from './externalFlows'

const CURRENCY_ORDER = ['ARS', 'USD_MEP', 'USD_CABLE'] as const satisfies readonly CurrencyCode[]

export interface AttributionSide {
  amount: Decimal
  fxRate: Decimal | null
}

export interface CashAttributionInput {
  opening: ReadonlyMap<CurrencyCode, AttributionSide>
  closing: ReadonlyMap<CurrencyCode, AttributionSide>
  transactions: readonly Transaction[]
  baseCurrency: CurrencyCode
  totalEconomicResult: Decimal
}

interface CurrencyEffects {
  dividends: Decimal
  interest: Decimal
  fees: Decimal
  taxes: Decimal
  fxValuationChange: Decimal
  classifiedAmount: Decimal
  dividendInflows: Decimal
  missingFx: boolean
  hasPerformance: boolean
}

/**
 * Reparte cashEconomicResult sin cambiarlo.
 * Un dividendo en moneda extranjera se valúa al tipo de cambio de la
 * transacción. Lo que el saldo sigue moviéndose hasta el cierre entra
 * en fxValuationChange. Si falta ese tipo de cambio, no se inventa:
 * el efecto queda en otherCashResult.
 * Aportes y retiros reconcilian cantidad y no son rendimiento.
 */
export function attributeCash(input: CashAttributionInput): {
  attribution: CashAttributionBreakdown
  currencies: CashCurrencyAttribution[]
} {
  const currencies = CURRENCY_ORDER.filter(
    (currency) =>
      input.opening.has(currency) ||
      input.closing.has(currency) ||
      input.transactions.some(
        (transaction) =>
          transaction.currency === currency && isCashAmountMovement(transaction.type),
      ),
  )

  let dividends = zeroDecimal()
  let interest = zeroDecimal()
  let fees = zeroDecimal()
  let taxes = zeroDecimal()
  let fxValuationChange = zeroDecimal()
  const currencyAttributions: CashCurrencyAttribution[] = []

  for (const currency of currencies) {
    const opening = input.opening.get(currency) ?? absentSide()
    const closing = input.closing.get(currency) ?? absentSide()
    const effects = effectsForCurrency(currency, opening, closing, input.transactions, input.baseCurrency)

    dividends = dividends.plus(effects.dividends)
    interest = interest.plus(effects.interest)
    fees = fees.plus(effects.fees)
    taxes = taxes.plus(effects.taxes)
    fxValuationChange = fxValuationChange.plus(effects.fxValuationChange)

    const amountDifference = closing.amount.minus(opening.amount).minus(effects.classifiedAmount)
    currencyAttributions.push({
      currency,
      openingAmount: formatExact(opening.amount),
      closingAmount: formatExact(closing.amount),
      classifiedAmountChange: formatExact(effects.classifiedAmount),
      dividendInflows: formatExact(effects.dividendInflows),
      amountDifference: formatExact(amountDifference),
      ...currencyStatuses(currency, input.baseCurrency, effects, amountDifference),
    })
  }

  const otherCashResult = input.totalEconomicResult
    .minus(fxValuationChange)
    .minus(dividends)
    .minus(interest)
    .plus(fees)
    .plus(taxes)

  return {
    attribution: {
      totalEconomicResult: formatExact(input.totalEconomicResult),
      fxValuationChange: formatExact(fxValuationChange),
      dividends: formatExact(dividends),
      interest: formatExact(interest),
      fees: formatExact(fees),
      taxes: formatExact(taxes),
      otherCashResult: formatExact(otherCashResult),
    },
    currencies: currencyAttributions,
  }
}

function effectsForCurrency(
  currency: CurrencyCode,
  opening: AttributionSide,
  closing: AttributionSide,
  transactions: readonly Transaction[],
  baseCurrency: CurrencyCode,
): CurrencyEffects {
  let dividends = zeroDecimal()
  let interest = zeroDecimal()
  let fees = zeroDecimal()
  let taxes = zeroDecimal()
  let fxValuationChange = zeroDecimal()
  let classifiedAmount = zeroDecimal()
  let dividendInflows = zeroDecimal()
  let missingFx = false
  let hasPerformance = false

  if (currency !== baseCurrency && opening.fxRate !== null && closing.fxRate !== null) {
    fxValuationChange = opening.amount.times(closing.fxRate.minus(opening.fxRate))
  }

  for (const transaction of transactions) {
    if (transaction.currency !== currency || !isCashAmountMovement(transaction.type)) continue

    if (transaction.type === 'CONTRIBUTION' || transaction.type === 'WITHDRAWAL') {
      const amount = parseDecimal(resolveExternalFlowAmount(transaction))
      classifiedAmount =
        transaction.type === 'CONTRIBUTION'
          ? classifiedAmount.plus(amount)
          : classifiedAmount.minus(amount)
      continue
    }

    hasPerformance = true
    const quantity = signedCashQuantity(transaction)
    classifiedAmount = classifiedAmount.plus(quantity)
    if (transaction.type === 'DIVIDEND') dividendInflows = dividendInflows.plus(quantity)

    if (currency !== baseCurrency && transaction.fxRate === null) {
      missingFx = true
      continue
    }

    const rate = currency === baseCurrency ? null : parseDecimal(transaction.fxRate ?? '0')
    const income = transaction.type === 'DIVIDEND' || transaction.type === 'INTEREST'
      ? attributeIncome(transaction)
      : null
    const cost = income === null ? standaloneCost(transaction) : null

    if (income !== null) {
      const amount = inBase(income.amount, rate)
      const incomeFees = inBase(income.fees, rate)
      const incomeTaxes = inBase(income.taxes, rate)
      if (transaction.type === 'DIVIDEND') dividends = dividends.plus(amount)
      else interest = interest.plus(amount)
      fees = fees.plus(incomeFees)
      taxes = taxes.plus(incomeTaxes)
    } else if (cost !== null) {
      const amount = inBase(cost, rate)
      if (transaction.type === 'FEE') fees = fees.plus(amount)
      else taxes = taxes.plus(amount)
    }

    if (rate !== null && closing.fxRate !== null) {
      fxValuationChange = fxValuationChange.plus(quantity.times(closing.fxRate.minus(rate)))
    }
  }

  return {
    dividends,
    interest,
    fees,
    taxes,
    fxValuationChange,
    classifiedAmount,
    dividendInflows,
    missingFx,
    hasPerformance,
  }
}

function currencyStatuses(
  currency: CurrencyCode,
  baseCurrency: CurrencyCode,
  effects: CurrencyEffects,
  amountDifference: Decimal,
): Pick<CashCurrencyAttribution, 'amountStatus' | 'attributionStatus'> {
  const amountStatus = amountDifference.isZero() ? 'RECONCILED' : 'AMOUNT_MISMATCH'
  if (currency === baseCurrency) {
    return { amountStatus, attributionStatus: 'BASE_CURRENCY' }
  }
  if (effects.missingFx) {
    return { amountStatus, attributionStatus: 'MISSING_TRANSACTION_FX' }
  }
  if (!effects.hasPerformance && effects.classifiedAmount.isZero()) {
    return {
      amountStatus,
      attributionStatus: amountDifference.isZero() ? 'FX_ONLY' : 'UNCLASSIFIED',
    }
  }
  return { amountStatus, attributionStatus: 'CLASSIFIED' }
}

function inBase(amount: Decimal, fxRate: Decimal | null): Decimal {
  if (fxRate === null) return amount
  return amount.times(fxRate)
}

/**
 * Misma política que el rendimiento explícito.
 * Con bruto, los fees y taxes de la fila van aparte.
 * Solo con neto, el neto ya puede incluirlos y no se restan de nuevo.
 */
function attributeIncome(transaction: Transaction): { amount: Decimal; fees: Decimal; taxes: Decimal } {
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

function signedCashQuantity(transaction: Transaction): Decimal {
  if (transaction.type === 'FEE' || transaction.type === 'TAX') {
    return standaloneCost(transaction).negated()
  }

  if (transaction.netAmount !== null) return parseDecimal(transaction.netAmount)

  const income = attributeIncome(transaction)
  return income.amount.minus(income.fees).minus(income.taxes)
}

function standaloneCost(transaction: Transaction): Decimal {
  const amount = transaction.netAmount ?? transaction.grossAmount
  if (amount === null) {
    throw new MissingTransactionAmountError(transaction.id, transaction.type)
  }
  return parseDecimal(amount).abs()
}

function positiveMagnitude(value: string | null): Decimal {
  if (value === null) return zeroDecimal()
  return parseDecimal(value).abs()
}

function absentSide(): AttributionSide {
  return { amount: zeroDecimal(), fxRate: null }
}

function isCashAmountMovement(
  type: TransactionType,
): type is 'CONTRIBUTION' | 'WITHDRAWAL' | 'DIVIDEND' | 'INTEREST' | 'FEE' | 'TAX' {
  return (
    type === 'CONTRIBUTION' ||
    type === 'WITHDRAWAL' ||
    type === 'DIVIDEND' ||
    type === 'INTEREST' ||
    type === 'FEE' ||
    type === 'TAX'
  )
}
