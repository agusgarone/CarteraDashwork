import type { DecimalString } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'

/**
 * Caja de una moneda entre dos snapshots, valuada en moneda base.
 *
 * fxValuationChange solo existe cuando la cantidad no cambió: ahí la
 * diferencia de valor es revaluación por tipo de cambio.
 * Si la cantidad cambió, el valor nuevo puede ser caja recibida en el
 * período y no se etiqueta como tipo de cambio.
 */
export type CashCurrencyStatus = 'BASE_CURRENCY' | 'UNCHANGED_AMOUNT' | 'AMOUNT_CHANGED'

export interface CashValuationResult {
  currency: CurrencyCode

  openingAmount: DecimalString
  closingAmount: DecimalString

  openingFxRate: DecimalString | null
  closingFxRate: DecimalString | null

  openingValue: DecimalString
  closingValue: DecimalString

  valueChange: DecimalString
  fxValuationChange: DecimalString | null

  status: CashCurrencyStatus
}

/**
 * La fórmula simple de esta versión:
 * cashEconomicResult = closingCash − openingCash − netContributions.
 *
 * Solo vale si en el período no hay compras, ventas, suscripciones,
 * rescates ni conversiones. Esos movimientos mueven valor entre caja
 * y títulos, o entre monedas, y esta versión no los separa.
 *
 * cashEconomicResult es un bucket agregado. Cuando entra completo a
 * explainedResult, los dividendos, intereses, comisiones e impuestos
 * que ya están dentro de la variación de caja no se suman otra vez.
 * La descomposición vive en attribution y no modifica el total:
 * cashEconomicResult = fx + dividends + interest − fees − taxes + other.
 */
export interface CashAttributionBreakdown {
  totalEconomicResult: DecimalString
  fxValuationChange: DecimalString
  dividends: DecimalString
  interest: DecimalString
  fees: DecimalString
  taxes: DecimalString
  otherCashResult: DecimalString
}

/**
 * La cantidad de caja y su valor en moneda base se miran por separado.
 * RECONCILED significa que los movimientos cierran el saldo en esa moneda.
 * MISSING_TRANSACTION_FX puede convivir con una cantidad reconciliada:
 * sabemos de dónde salieron los dólares, pero no cómo partir su valor en pesos.
 */
export type CashAmountStatus = 'RECONCILED' | 'AMOUNT_MISMATCH'

export type CashValueAttributionStatus =
  | 'FX_ONLY'
  | 'MISSING_TRANSACTION_FX'
  | 'CLASSIFIED'
  | 'BASE_CURRENCY'
  | 'UNCLASSIFIED'

export interface CashCurrencyAttribution {
  currency: CurrencyCode
  openingAmount: DecimalString
  closingAmount: DecimalString
  classifiedAmountChange: DecimalString
  /** Cantidad de DIVIDEND en esta moneda. No es el ingreso ya convertido a pesos. */
  dividendInflows: DecimalString
  amountDifference: DecimalString
  amountStatus: CashAmountStatus
  attributionStatus: CashValueAttributionStatus
}

export type CashReconciliationStatus =
  | 'EXPLAINED'
  | 'HAS_INTERNAL_CASH_MOVEMENTS'
  | 'CASH_LEDGER_RECONCILED'

export interface CashReconciliationResult {
  balances: CashValuationResult[]

  openingCashValue: DecimalString
  closingCashValue: DecimalString
  totalCashValueChange: DecimalString

  externalNetFlows: DecimalString

  cashEconomicResult: DecimalString | null
  /** FX de saldos cuya cantidad no cambió. El FX clasificado completo está en attribution. */
  fxValuationChange: DecimalString

  attribution: CashAttributionBreakdown | null
  currencyAttributions: CashCurrencyAttribution[]

  status: CashReconciliationStatus
  reason: string | null
}
