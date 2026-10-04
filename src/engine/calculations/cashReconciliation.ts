import type Decimal from 'decimal.js'
import type { DecimalString } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import type { CashBalance } from '../../domain/snapshot'
import type { Transaction, TransactionType } from '../../domain/transaction'
import { AnalysisError } from '../errors/analysisErrors'
import { formatExact, parseDecimal, zeroDecimal } from '../money'
import type {
  CashCurrencyStatus,
  CashReconciliationResult,
  CashValuationResult,
} from '../models/cashReconciliation'
import { attributeCash } from './cashAttribution'

const CURRENCY_ORDER = ['ARS', 'USD_MEP', 'USD_CABLE'] as const satisfies readonly CurrencyCode[]

const INTERNAL_CASH_MOVEMENT_TYPES = [
  'BUY',
  'SELL',
  'FUND_SUBSCRIPTION',
  'FUND_REDEMPTION',
  'FX_CONVERSION',
] as const satisfies readonly TransactionType[]

export interface CashReconciliationInput {
  openingCashBalances: readonly CashBalance[]
  closingCashBalances: readonly CashBalance[]
  baseCurrency: CurrencyCode
  /** netContributions ya calculado por el análisis base. No se rederive acá. */
  netContributions: DecimalString
  transactions: readonly Transaction[]
}

interface CashSide {
  amount: Decimal
  fxRate: Decimal | null
  fxRateText: DecimalString | null
  value: Decimal
}

/**
 * Valúa la caja en moneda base y, si no hay transferencias internas,
 * obtiene el resultado económico después de aportes y retiros.
 *
 * Una moneda ausente en un snapshot vale 0. La caja puede aparecer
 * o desaparecer; eso no es una posición faltante.
 * La fuente de valor es valueInBaseCurrency cuando viene cargado.
 * Si también se puede calcular amount o amount × fxRate, tienen que coincidir.
 */
export function reconcileCash(input: CashReconciliationInput): CashReconciliationResult {
  const opening = indexCash(input.openingCashBalances, input.baseCurrency)
  const closing = indexCash(input.closingCashBalances, input.baseCurrency)
  const currencies = CURRENCY_ORDER.filter(
    (currency) => opening.has(currency) || closing.has(currency),
  )

  const balances = currencies.map((currency) =>
    valuateCurrency(
      currency,
      input.baseCurrency,
      opening.get(currency) ?? absentCash(),
      closing.get(currency) ?? absentCash(),
    ),
  )

  let openingCashValue = zeroDecimal()
  let closingCashValue = zeroDecimal()
  let fxValuationChange = zeroDecimal()
  for (const balance of balances) {
    openingCashValue = openingCashValue.plus(balance.openingValue)
    closingCashValue = closingCashValue.plus(balance.closingValue)
    if (balance.fxValuationChange !== null) {
      fxValuationChange = fxValuationChange.plus(balance.fxValuationChange)
    }
  }

  const totalCashValueChange = closingCashValue.minus(openingCashValue)
  const externalNetFlows = parseDecimal(input.netContributions)
  const invalidated = hasInternalCashMovement(input.transactions)
  const cashEconomicResult = totalCashValueChange.minus(externalNetFlows)
  const attributed = invalidated
    ? null
    : attributeCash({
        opening,
        closing,
        transactions: input.transactions,
        baseCurrency: input.baseCurrency,
        totalEconomicResult: cashEconomicResult,
      })

  return {
    balances,
    openingCashValue: formatExact(openingCashValue),
    closingCashValue: formatExact(closingCashValue),
    totalCashValueChange: formatExact(totalCashValueChange),
    externalNetFlows: formatExact(externalNetFlows),
    cashEconomicResult: invalidated ? null : formatExact(cashEconomicResult),
    fxValuationChange: formatExact(fxValuationChange),
    attribution: attributed?.attribution ?? null,
    currencyAttributions: attributed?.currencies ?? [],
    status: invalidated ? 'HAS_INTERNAL_CASH_MOVEMENTS' : 'EXPLAINED',
    reason: invalidated
      ? 'Hay compras, ventas, fondos o conversiones. La variación de caja mezcla rendimiento y transferencias internas.'
      : null,
  }
}

function valuateCurrency(
  currency: CurrencyCode,
  baseCurrency: CurrencyCode,
  opening: CashSide,
  closing: CashSide,
): CashValuationResult {
  const valueChange = closing.value.minus(opening.value)
  const foreign = classifyForeignCash(currency, baseCurrency, opening, closing)

  return {
    currency,
    openingAmount: formatExact(opening.amount),
    closingAmount: formatExact(closing.amount),
    openingFxRate: opening.fxRateText,
    closingFxRate: closing.fxRateText,
    openingValue: formatExact(opening.value),
    closingValue: formatExact(closing.value),
    valueChange: formatExact(valueChange),
    fxValuationChange: foreign.fxValuationChange,
    status: foreign.status,
  }
}

function classifyForeignCash(
  currency: CurrencyCode,
  baseCurrency: CurrencyCode,
  opening: CashSide,
  closing: CashSide,
): { status: CashCurrencyStatus; fxValuationChange: DecimalString | null } {
  if (currency === baseCurrency) {
    return { status: 'BASE_CURRENCY', fxValuationChange: null }
  }

  if (!opening.amount.eq(closing.amount)) {
    return { status: 'AMOUNT_CHANGED', fxValuationChange: null }
  }

  if (opening.amount.isZero()) {
    return { status: 'UNCHANGED_AMOUNT', fxValuationChange: formatExact(zeroDecimal()) }
  }

  if (opening.fxRate === null || closing.fxRate === null) {
    return { status: 'UNCHANGED_AMOUNT', fxValuationChange: null }
  }

  const fxValuationChange = opening.amount.times(closing.fxRate.minus(opening.fxRate))
  return { status: 'UNCHANGED_AMOUNT', fxValuationChange: formatExact(fxValuationChange) }
}

function indexCash(
  balances: readonly CashBalance[],
  baseCurrency: CurrencyCode,
): Map<CurrencyCode, CashSide> {
  const indexed = new Map<CurrencyCode, CashSide>()
  for (const balance of balances) {
    if (indexed.has(balance.currency)) {
      throw new AnalysisError(`La caja en ${balance.currency} está repetida en el snapshot.`)
    }
    indexed.set(balance.currency, cashSide(balance, baseCurrency))
  }
  return indexed
}

function cashSide(balance: CashBalance, baseCurrency: CurrencyCode): CashSide {
  const amount = parseDecimal(balance.amount)
  const fxRate = balance.fxRate === null ? null : parseDecimal(balance.fxRate)
  return {
    amount,
    fxRate,
    fxRateText: fxRate === null ? null : formatExact(fxRate),
    value: valueInBase(balance, amount, fxRate, baseCurrency),
  }
}

/**
 * valueInBaseCurrency manda cuando está cargado.
 * La moneda base vale el amount. Una moneda extranjera vale amount × fxRate.
 * Si el valor persistido no coincide con ese cálculo, no se elige uno de los dos.
 */
function valueInBase(
  balance: CashBalance,
  amount: Decimal,
  fxRate: Decimal | null,
  baseCurrency: CurrencyCode,
): Decimal {
  const derived = derivedValue(balance.currency, amount, fxRate, baseCurrency)
  if (balance.valueInBaseCurrency === null) {
    if (derived === null) {
      throw new AnalysisError(
        `La caja en ${balance.currency} no tiene valor en ${baseCurrency} ni tipo de cambio para calcularlo.`,
      )
    }
    return derived
  }

  const persisted = parseDecimal(balance.valueInBaseCurrency)
  if (derived !== null && !persisted.eq(derived)) {
    throw new AnalysisError(
      `El valor en moneda base de la caja ${balance.currency} no coincide con su cálculo.`,
    )
  }
  return persisted
}

function derivedValue(
  currency: CurrencyCode,
  amount: Decimal,
  fxRate: Decimal | null,
  baseCurrency: CurrencyCode,
): Decimal | null {
  if (currency === baseCurrency) return amount
  if (amount.isZero()) return zeroDecimal()
  if (fxRate === null) return null
  return amount.times(fxRate)
}

function absentCash(): CashSide {
  return {
    amount: zeroDecimal(),
    fxRate: null,
    fxRateText: null,
    value: zeroDecimal(),
  }
}

function hasInternalCashMovement(transactions: readonly Transaction[]): boolean {
  return transactions.some((transaction) => isInternalCashMovement(transaction.type))
}

function isInternalCashMovement(
  type: TransactionType,
): type is (typeof INTERNAL_CASH_MOVEMENT_TYPES)[number] {
  for (const candidate of INTERNAL_CASH_MOVEMENT_TYPES) {
    if (candidate === type) return true
  }
  return false
}
