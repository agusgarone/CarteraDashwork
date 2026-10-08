import Decimal from 'decimal.js'
import type { DecimalString } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import { formatExact, parseDecimal, zeroDecimal } from '../money'

export type CashLegRole =
  | 'EXTERNAL_FLOW'
  | 'TRADE_SETTLEMENT'
  | 'FUND_SETTLEMENT'
  | 'FX_CONVERSION'
  | 'DIVIDEND'
  | 'INTEREST'
  | 'FEE'
  | 'TAX'
  | 'OTHER'

/**
 * Pata de caja ya firmada.
 * Entrada positiva, salida negativa. No se reconcilia con valor absoluto.
 */
export interface CashMovementLeg {
  operationId: string | null
  operationType: string
  currency: CurrencyCode
  amount: DecimalString
  date: string
  role: CashLegRole
  /** Componentes de la fila de caja. No se suman todos: pueden repetirse entre monedas. */
  commission?: DecimalString | null
  vat?: DecimalString | null
  marketFees?: DecimalString | null
  taxComponent?: DecimalString | null
}

export type CashLedgerCurrencyStatus = 'RECONCILED' | 'AMOUNT_MISMATCH'

export interface CashRoleTotals {
  externalFlows: DecimalString
  tradeSettlements: DecimalString
  fundSettlements: DecimalString
  dividends: DecimalString
  interest: DecimalString
  taxes: DecimalString
  fxConversions: DecimalString
  fees: DecimalString
  other: DecimalString
}

export interface CashCurrencyLedgerResult {
  currency: CurrencyCode
  openingAmount: DecimalString
  movementsTotal: DecimalString
  closingAmount: DecimalString
  difference: DecimalString
  status: CashLedgerCurrencyStatus
  roles: CashRoleTotals
}

export interface CashLedgerResult {
  currencies: CashCurrencyLedgerResult[]
  status: 'RECONCILED' | 'AMOUNT_MISMATCH'
}

export interface CashAmount {
  currency: CurrencyCode
  amount: DecimalString
}

const CURRENCY_ORDER = ['ARS', 'USD_MEP', 'USD_CABLE'] as const satisfies readonly CurrencyCode[]

const ROLE_FIELD: Record<CashLegRole, keyof CashRoleTotals> = {
  EXTERNAL_FLOW: 'externalFlows',
  TRADE_SETTLEMENT: 'tradeSettlements',
  FUND_SETTLEMENT: 'fundSettlements',
  DIVIDEND: 'dividends',
  INTEREST: 'interest',
  TAX: 'taxes',
  FX_CONVERSION: 'fxConversions',
  FEE: 'fees',
  OTHER: 'other',
}

/**
 * Cierra la cantidad de caja por moneda.
 * No convierte a pesos y no decide qué parte es rendimiento.
 */
export function reconcileCashLedger(input: {
  opening: readonly CashAmount[]
  closing: readonly CashAmount[]
  legs: readonly CashMovementLeg[]
}): CashLedgerResult {
  const opening = indexAmounts(input.opening)
  const closing = indexAmounts(input.closing)
  const currencies = CURRENCY_ORDER.filter(
    (currency) => opening.has(currency) || closing.has(currency) || input.legs.some((leg) => leg.currency === currency),
  )

  const results = currencies.map((currency) =>
    reconcileCurrency(
      currency,
      opening.get(currency) ?? zeroDecimal(),
      closing.get(currency) ?? zeroDecimal(),
      input.legs.filter((leg) => leg.currency === currency),
    ),
  )

  return {
    currencies: results,
    status: results.every((currency) => currency.status === 'RECONCILED') ? 'RECONCILED' : 'AMOUNT_MISMATCH',
  }
}

function reconcileCurrency(
  currency: CurrencyCode,
  opening: Decimal,
  closing: Decimal,
  legs: readonly CashMovementLeg[],
): CashCurrencyLedgerResult {
  const roles = emptyRoles()
  let movements = zeroDecimal()
  for (const leg of legs) {
    const amount = parseDecimal(leg.amount)
    movements = movements.plus(amount)
    const field = ROLE_FIELD[leg.role]
    roles[field] = roles[field].plus(amount)
  }
  const expectedClosing = opening.plus(movements)
  const difference = closing.minus(expectedClosing)
  return {
    currency,
    openingAmount: formatExact(opening),
    movementsTotal: formatExact(movements),
    closingAmount: formatExact(closing),
    difference: formatExact(difference),
    status: difference.isZero() ? 'RECONCILED' : 'AMOUNT_MISMATCH',
    roles: {
      externalFlows: formatExact(roles.externalFlows),
      tradeSettlements: formatExact(roles.tradeSettlements),
      fundSettlements: formatExact(roles.fundSettlements),
      dividends: formatExact(roles.dividends),
      interest: formatExact(roles.interest),
      taxes: formatExact(roles.taxes),
      fxConversions: formatExact(roles.fxConversions),
      fees: formatExact(roles.fees),
      other: formatExact(roles.other),
    },
  }
}

function emptyRoles(): Record<keyof CashRoleTotals, Decimal> {
  return {
    externalFlows: zeroDecimal(),
    tradeSettlements: zeroDecimal(),
    fundSettlements: zeroDecimal(),
    dividends: zeroDecimal(),
    interest: zeroDecimal(),
    taxes: zeroDecimal(),
    fxConversions: zeroDecimal(),
    fees: zeroDecimal(),
    other: zeroDecimal(),
  }
}

function indexAmounts(amounts: readonly CashAmount[]): Map<CurrencyCode, Decimal> {
  const indexed = new Map<CurrencyCode, Decimal>()
  for (const amount of amounts) {
    const current = indexed.get(amount.currency) ?? zeroDecimal()
    indexed.set(amount.currency, current.plus(parseDecimal(amount.amount)))
  }
  return indexed
}
