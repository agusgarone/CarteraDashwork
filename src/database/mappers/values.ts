import type { DecimalString, EntityId } from '../../domain/common'
import type { CorporateActionType } from '../../domain/corporateAction'
import type { CurrencyCode } from '../../domain/currency'
import type { DocumentProcessingStatus, DocumentType } from '../../domain/document'
import type { InstrumentCategory } from '../../domain/instrument'
import type { PeriodStatus } from '../../domain/period'
import type { ReconciliationStatus } from '../../domain/reconciliation'
import type { TransactionType } from '../../domain/transaction'
import { RepositoryError } from '../errors'

function mapEnum<T extends string>(value: string, allowed: readonly T[], label: string): T {
  for (const candidate of allowed) {
    if (candidate === value) return candidate
  }
  throw new RepositoryError(`${label} persistido no reconocido: ${value}`)
}

const CURRENCY_CODES = ['ARS', 'USD_MEP', 'USD_CABLE'] as const satisfies readonly CurrencyCode[]
const PERIOD_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETE', 'ERROR'] as const satisfies readonly PeriodStatus[]
const DOCUMENT_TYPES = [
  'CONSOLIDATED_POSITION',
  'PERIOD_RESULTS',
  'MONTHLY_ACCOUNT',
  'MONTHLY_FUND_STATEMENT',
  'OTHER',
] as const satisfies readonly DocumentType[]
const DOCUMENT_PROCESSING_STATUSES = [
  'PENDING',
  'PROCESSING',
  'PROCESSED',
  'ERROR',
] as const satisfies readonly DocumentProcessingStatus[]
const INSTRUMENT_CATEGORIES = [
  'CEDEAR',
  'STOCK',
  'CORPORATE_BOND',
  'BOND',
  'FUND',
  'OTHER',
] as const satisfies readonly InstrumentCategory[]
const TRANSACTION_TYPES = [
  'CONTRIBUTION',
  'WITHDRAWAL',
  'BUY',
  'SELL',
  'DIVIDEND',
  'INTEREST',
  'FUND_SUBSCRIPTION',
  'FUND_REDEMPTION',
  'FEE',
  'TAX',
  'FX_CONVERSION',
  'OTHER',
] as const satisfies readonly TransactionType[]
const CORPORATE_ACTION_TYPES = [
  'STOCK_DIVIDEND',
  'SPLIT',
  'REVERSE_SPLIT',
  'RATIO_CHANGE',
  'OTHER',
] as const satisfies readonly CorporateActionType[]
const RECONCILIATION_STATUSES = [
  'RECONCILED',
  'WARNING',
  'FAILED',
] as const satisfies readonly ReconciliationStatus[]

export function mapId(value: number): EntityId {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RepositoryError('Id persistido no es un entero')
  }
  return String(value)
}

export function mapNullableId(value: number | null): EntityId | null {
  if (value === null) return null
  return mapId(value)
}

/** El TEXT financiero se conserva. No se convierte a number. */
export function mapDecimal(value: string): DecimalString {
  if (typeof value !== 'string') {
    throw new RepositoryError('Un importe persistido no llegó como texto')
  }
  return value
}

export function mapNullableDecimal(value: string | null): DecimalString | null {
  if (value === null) return null
  return mapDecimal(value)
}

export function mapInteger(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RepositoryError(`${label} persistido no es un entero`)
  }
  return value
}

export function mapNullableText(value: string | null): string | null {
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new RepositoryError('Un texto persistido no llegó como string')
  }
  return value
}

export function mapCurrency(value: string): CurrencyCode {
  return mapEnum(value, CURRENCY_CODES, 'Moneda')
}

export function mapPeriodStatus(value: string): PeriodStatus {
  return mapEnum(value, PERIOD_STATUSES, 'Estado de período')
}

export function mapDocumentType(value: string): DocumentType {
  return mapEnum(value, DOCUMENT_TYPES, 'Tipo de documento')
}

export function mapDocumentProcessingStatus(value: string): DocumentProcessingStatus {
  return mapEnum(value, DOCUMENT_PROCESSING_STATUSES, 'Estado de documento')
}

export function mapInstrumentCategory(value: string): InstrumentCategory {
  return mapEnum(value, INSTRUMENT_CATEGORIES, 'Categoría de instrumento')
}

export function mapTransactionType(value: string): TransactionType {
  return mapEnum(value, TRANSACTION_TYPES, 'Tipo de movimiento')
}

export function mapCorporateActionType(value: string): CorporateActionType {
  return mapEnum(value, CORPORATE_ACTION_TYPES, 'Tipo de corporate action')
}

export function mapReconciliationStatus(value: string): ReconciliationStatus {
  return mapEnum(value, RECONCILIATION_STATUSES, 'Estado de reconciliación')
}
