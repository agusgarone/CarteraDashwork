import Decimal from 'decimal.js'
import type { ReconciliationStatus } from '../domain/reconciliation'
import type { PeriodPerformanceAnalysis } from '../engine/models/periodPerformance'

/**
 * Una diferencia distinta de cero no es un error del import.
 * Es el resto que el motor todavía no explica.
 * FAILED queda para cuando la caja simple no se puede explicar.
 * RECONCILED solo cuando ese resto es cero.
 */
export function reconciliationStatus(analysis: PeriodPerformanceAnalysis): ReconciliationStatus {
  if (analysis.performance.cash.status !== 'EXPLAINED') return 'FAILED'
  if (!new Decimal(analysis.performance.unexplainedDifference).isZero()) return 'WARNING'
  return 'RECONCILED'
}
