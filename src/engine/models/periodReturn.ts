import type { DecimalString, EntityId } from '../../domain/common'

export interface ModifiedDietzFlow {
  transactionId: EntityId
  date: string
  /** Aporte positivo, retiro negativo. */
  amount: DecimalString
  weight: DecimalString
  weightedAmount: DecimalString
}

/**
 * Rendimiento del período. No es anualizado y no entra en la reconciliación.
 * returnDecimal es un ratio: 0.0067 es 0,67% recién al mostrarlo.
 */
export type PeriodReturnResult =
  | {
      status: 'CALCULATED'
      method: 'MODIFIED_DIETZ'
      numerator: DecimalString
      weightedCapital: DecimalString
      returnDecimal: DecimalString
      externalFlows: ModifiedDietzFlow[]
    }
  | {
      status: 'INVALID_WEIGHTED_CAPITAL'
      method: 'MODIFIED_DIETZ'
      numerator: DecimalString
      weightedCapital: DecimalString
      returnDecimal: null
      reason: string
      externalFlows: ModifiedDietzFlow[]
    }
