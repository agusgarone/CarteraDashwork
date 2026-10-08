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

/**
 * Una pata de la misma operación económica.
 * La fila del instrumento y la fila de caja de un boleto no son dos operaciones.
 */
export interface ParsedOperationLeg {
  section: 'INSTRUMENT' | 'CASH' | 'NONE'
  currency: CurrencyCode | null
  quantity: DecimalString | null
  price: DecimalString | null
  gross: DecimalString | null
  fees: DecimalString | null
  taxes: DecimalString | null
  /** Arancel de la fila, sin sumarlo con derechos ni IVA. */
  commission: DecimalString | null
  /** IVA sobre el arancel, en la columna propia. */
  vat: DecimalString | null
  /** Derechos de mercado. */
  marketFees: DecimalString | null
  /** Otro IVA de la fila. Puede repetir una parte ya incluida en vat. */
  taxComponent: DecimalString | null
  net: DecimalString | null
  date: string | null
  settlementDate: string | null
  rawDescription: string
}

/**
 * Operación leída del resumen, antes de achicarla a una Transaction.
 * Las patas de caja quedan acá para una conciliación posterior.
 */
export interface ParsedOperationGroup {
  operationReference: string | null
  operationType: TransactionType | 'STOCK_DIVIDEND' | 'KNOWN_NON_ECONOMIC'
  instrument: string | null
  date: string | null
  settlementDate: string | null
  legs: ParsedOperationLeg[]
}

/** Conversión cuyas patas comparten descripción y fecha de concertación. */
export interface ParsedFxOperation {
  operationReference: string | null
  date: string | null
  settlementDate: string | null
  legs: ParsedOperationLeg[]
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
  operationGroups: ParsedOperationGroup[]
  fxOperations: ParsedFxOperation[]
  warnings: ParserWarning[]
}
