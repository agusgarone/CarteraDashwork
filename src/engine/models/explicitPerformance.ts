import type { DecimalString } from '../../domain/common'
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
 */
export interface PerformanceReconciliationResult {
  expectedResult: DecimalString
  breakdown: PerformanceBreakdown
  positionResults: PositionValuationResult[]
  cash: CashReconciliationResult
  explainedResult: DecimalString
  unexplainedDifference: DecimalString
}
