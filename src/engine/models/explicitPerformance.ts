import type { DecimalString } from '../../domain/common'
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

/** Desglose calculado. valuationChange no es marketChange. */
export interface PerformanceBreakdown extends ExplicitPerformanceBreakdown {
  valuationChange: DecimalString
}

/**
 * Reconciliación todavía no persistida.
 * expectedResult, explainedResult y unexplainedDifference son los tres
 * valores que después puede guardar un ReconciliationRun.
 * unexplainedDifference no es variación de mercado: también puede incluir
 * tipo de cambio, caja, compras y ventas, acciones corporativas, redondeo
 * y movimientos que esta versión no clasifica.
 */
export interface PerformanceReconciliationResult {
  expectedResult: DecimalString
  breakdown: PerformanceBreakdown
  positionResults: PositionValuationResult[]
  explainedResult: DecimalString
  unexplainedDifference: DecimalString
}
