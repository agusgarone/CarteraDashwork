import type { DecimalString, EntityId } from './common'

export interface PeriodFxReferenceSource {
  kind: 'EXPLICIT_SNAPSHOT_RATE'
  broker: 'BALANZ'
  documentId: EntityId
  documentType: 'CONSOLIDATED_POSITION'
  originalFilename: string
  localPath: string
  sha256: string
  parserVersion: string | null
  cashBalanceId: EntityId
  field: 'cash_balances.fx_rate'
  documentField: 'Tipo de cambio: MEP'
}

export type PeriodFxReferenceUnavailableReason =
  | 'PERIOD_NOT_FOUND'
  | 'PERIOD_NOT_IMPORTED'
  | 'UNSUPPORTED_PORTFOLIO'
  | 'CLOSING_SNAPSHOT_NOT_FOUND'
  | 'CLOSING_SNAPSHOT_OUTSIDE_PERIOD'
  | 'SNAPSHOT_SOURCE_UNAVAILABLE'
  | 'MISSING_USD_MEP_BALANCE'
  | 'AMBIGUOUS_USD_MEP_BALANCE'
  | 'MISSING_EXPLICIT_USD_MEP_RATE'
  | 'INVALID_USD_MEP_RATE'

/** Presentation reference only. No converted portfolio values are persisted. */
export type PeriodFxReference =
  | {
      status: 'AVAILABLE'
      periodId: EntityId
      currency: 'USD_MEP'
      rate: DecimalString
      /** Actual valuation date printed in the closing snapshot, not calendar month-end. */
      date: string
      snapshotId: EntityId
      source: PeriodFxReferenceSource
    }
  | {
      status: 'UNAVAILABLE'
      periodId: EntityId
      currency: 'USD_MEP'
      reason: PeriodFxReferenceUnavailableReason
    }