import type { DecimalString, EntityId } from './common'

export type ReconciliationStatus = 'RECONCILED' | 'WARNING' | 'FAILED'

/**
 * Resultado persistido de validar que un período cierra.
 *
 * Identidad conceptual, no implementada acá:
 * expectedResult = closingValue - openingValue - contributions + withdrawals
 *
 * Una reconciliación posterior intentará explicar expectedResult mediante
 * marketChange + dividends + interest - fees - taxes + FX + other.
 * Esas fórmulas pertenecen al PortfolioEngine, no a este modelo.
 */
export interface ReconciliationRun {
  id: EntityId
  periodId: EntityId

  openingValue: DecimalString
  closingValue: DecimalString

  contributions: DecimalString
  withdrawals: DecimalString

  expectedResult: DecimalString
  explainedResult: DecimalString

  difference: DecimalString

  status: ReconciliationStatus

  engineVersion: string

  createdAt: string
}
