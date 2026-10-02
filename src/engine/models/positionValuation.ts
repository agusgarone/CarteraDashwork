import type { DecimalString, EntityId } from '../../domain/common'

/**
 * Variación simple de una posición entre dos snapshots.
 * Si un lado no existe, su cantidad y su valor quedan en null:
 * no se reemplazan por cero.
 */
export type PositionValuationStatus =
  | 'EXPLAINED'
  | 'QUANTITY_CHANGED'
  | 'HAS_PERIOD_TRANSACTION'
  | 'HAS_CORPORATE_ACTION'
  | 'MISSING_OPENING_POSITION'
  | 'MISSING_CLOSING_POSITION'

export interface PositionValuationResult {
  instrumentId: EntityId

  openingQuantity: DecimalString | null
  closingQuantity: DecimalString | null

  openingValue: DecimalString | null
  closingValue: DecimalString | null

  valuationChange: DecimalString | null

  status: PositionValuationStatus
  reason: string | null
}
