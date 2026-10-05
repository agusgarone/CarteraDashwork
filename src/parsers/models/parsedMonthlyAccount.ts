import type { DecimalString } from '../../domain/common'
import type { CorporateActionType } from '../../domain/corporateAction'
import type { CurrencyCode } from '../../domain/currency'
import type { TransactionType } from '../../domain/transaction'

export type ParserWarningCode =
  | 'UNKNOWN_MOVEMENT'
  | 'UNKNOWN_CURRENCY'
  | 'UNKNOWN_CATEGORY'
  | 'MISSING_AMOUNT'
  | 'MISSING_TICKER'
  | 'MISSING_DATE'
  | 'MISSING_QUANTITY'
  | 'MISSING_MARKET_VALUE'
  | 'AMBIGUOUS_CLASSIFICATION'
  | 'AMBIGUOUS_ROW'
  | 'DUPLICATE_INSTRUMENT'
  | 'CATEGORY_TOTAL_MISMATCH'

export interface ParserWarning {
  code: ParserWarningCode
  message: string
  sourceReference: string | null
}

/**
 * Movimiento ya clasificado, todavía sin instrumentId.
 * El import futuro resuelve el ticker contra InstrumentRepository.
 * Los importes de Neto y Bruto conservan el signo del documento.
 * Aportes y retiros guardan la magnitud positiva: el tipo indica la dirección.
 */
export interface NormalizedTransaction {
  date: string
  type: TransactionType
  ticker: string | null
  quantity: DecimalString | null
  unitPrice: DecimalString | null
  grossAmount: DecimalString | null
  netAmount: DecimalString | null
  fees: DecimalString | null
  taxes: DecimalString | null
  currency: CurrencyCode
  fxRate: DecimalString | null
  sourceReference: string
}

/** Acción corporativa leída del documento, sin ids de persistencia. */
export interface NormalizedCorporateAction {
  date: string
  type: CorporateActionType
  ticker: string
  quantityBefore: DecimalString | null
  quantityChange: DecimalString | null
  quantityAfter: DecimalString | null
  ratio: DecimalString | null
  description: string | null
  sourceReference: string
}

export interface ParsedMonthlyAccount {
  broker: 'BALANZ'
  documentType: 'MONTHLY_ACCOUNT'
  period: {
    startDate: string
    endDate: string
  }
  transactions: NormalizedTransaction[]
  corporateActions: NormalizedCorporateAction[]
  warnings: ParserWarning[]
}
