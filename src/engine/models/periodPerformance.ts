import type { PeriodBaseResult } from './periodBaseResult'
import type { PerformanceReconciliationResult } from './explicitPerformance'

/** Análisis base del período y la parte que ya se puede explicar. */
export interface PeriodPerformanceAnalysis {
  base: PeriodBaseResult
  performance: PerformanceReconciliationResult
}
