import type { DecimalString } from '../../domain/common'
import type { CashLedgerResult } from '../calculations/cashLedger'
import type { PendingAttribution, PositionValueFlowAnalysis } from '../calculations/positionValueFlow'
import type { CashReconciliationResult } from './cashReconciliation'
import type { PositionValuationResult } from './positionValuation'

/**
 * Parte del resultado que se puede atribuir a movimientos explícitos.
 * Comisiones e impuestos son magnitudes positivas: el signo se aplica
 * al armar explainedResult, no dentro de cada campo.
 */
export interface ExplicitPerformanceBreakdown {
  dividends: DecimalString
  interest: DecimalString
  fees: DecimalString
  taxes: DecimalString
}

/**
 * Desglose calculado. valuationChange no es marketChange.
 *
 * cashEconomicResult es el bucket de caja después de aportes y retiros.
 * null cuando hay transferencias internas y esta versión no lo calcula.
 * Si entra en explainedResult, los dividendos y costos que ya viven dentro
 * de ese bucket no se suman de nuevo. fxValuationChange queda en el detalle
 * de caja: es una parte del bucket, no otro sumando.
 */
export interface PerformanceBreakdown extends ExplicitPerformanceBreakdown {
  valuationChange: DecimalString
  cashEconomicResult: DecimalString | null
}

/**
 * Reconciliación todavía no persistida.
 * expectedResult, explainedResult y unexplainedDifference son los tres
 * valores que después puede guardar un ReconciliationRun.
 * unexplainedDifference no es variación de mercado ni un redondeo formal.
 * Puede incluir caja invalidada, compras y ventas, acciones corporativas
 * no cerradas y movimientos que esta versión no clasifica.
 *
 * Si attributionStatus es PENDING, la cantidad de caja puede estar cerrada
 * pero todavía no hay resultado explicado. Esos dos campos quedan en null:
 * no se publican como cero ni como el resultado base.
 */
export interface PerformanceReconciliationResult {
  expectedResult: DecimalString
  breakdown: PerformanceBreakdown
  positionResults: PositionValuationResult[]
  cash: CashReconciliationResult
  explainedResult: DecimalString | null
  unexplainedDifference: DecimalString | null
  attributionStatus: 'AVAILABLE' | 'PENDING'
  cashLedger: CashLedgerResult | null
  positionFlows: PositionValueFlowAnalysis[]
  /** Parte explicada sin presentar el resto como diferencia definitiva. */
  partialExplainedResult: DecimalString | null
  pendingAttribution: PendingAttribution | null
}
