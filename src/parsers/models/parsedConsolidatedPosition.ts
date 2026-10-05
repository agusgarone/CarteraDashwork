import type { DecimalString } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import type { ParserWarning } from './parsedMonthlyAccount'

/**
 * Categoría tal como la agrupa la Posición consolidada.
 * Acciones, Cedears, Corporativos y Fondos no son instrumentos.
 */
export type NormalizedHoldingCategory = 'STOCK' | 'CEDEAR' | 'CORPORATE_BOND' | 'FUND'

/**
 * Una tenencia de la foto.
 * No tiene instrumentId: el import futuro lo resuelve.
 * marketValue es el Valor Actual impreso. No se recalcula como cantidad por precio.
 *
 * Los fondos de esta posición suelen traer menos decimales que el resumen
 * cuotapartista. Este parser no consulta ese otro documento.
 */
export interface ParsedPosition {
  ticker: string
  name: string
  rawCategory: string
  normalizedCategory: NormalizedHoldingCategory
  quantity: DecimalString
  guarantee: DecimalString | null
  unitPrice: DecimalString | null
  marketValue: DecimalString
  sourceReference: string
}

/**
 * Caja informada por el documento.
 * reportedValueInBaseCurrency solo se completa cuando el PDF muestra ese
 * importe en pesos. En dólares el PDF muestra la cantidad y, aparte, el
 * tipo de cambio: el valor en pesos es calculatedValueInBaseCurrency.
 */
export interface ParsedCashBalance {
  currency: CurrencyCode
  amount: DecimalString
  fxRate: DecimalString | null
  reportedValueInBaseCurrency: DecimalString | null
  calculatedValueInBaseCurrency: DecimalString | null
}

export interface ParsedCategoryTotal {
  rawCategory: string
  normalizedCategory: NormalizedHoldingCategory
  reportedTotal: DecimalString
}

export interface CategoryCheck {
  rawCategory: string
  normalizedCategory: NormalizedHoldingCategory
  calculated: DecimalString
  reported: DecimalString
  difference: DecimalString
}

/** Comparación entre lo sumado y lo que el PDF declara. No redondea la diferencia a cero. */
export interface PositionDocumentReconciliation {
  positionsTotal: DecimalString
  cashCalculatedTotal: DecimalString
  calculatedPortfolioTotal: DecimalString
  reportedPortfolioTotal: DecimalString
  difference: DecimalString
  categoryChecks: CategoryCheck[]
}

export interface ParsedConsolidatedPosition {
  broker: 'BALANZ'
  snapshotDate: string
  issuedAt: string | null
  reportedTotal: DecimalString
  positions: ParsedPosition[]
  cashBalances: ParsedCashBalance[]
  categoryTotals: ParsedCategoryTotal[]
  reconciliation: PositionDocumentReconciliation
  warnings: ParserWarning[]
}
