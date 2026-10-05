import type { PeriodBaseResult } from './periodBaseResult'
import type { PerformanceReconciliationResult } from './explicitPerformance'
import type { PeriodReturnResult } from './periodReturn'

/** Análisis base del período y la parte que ya se puede explicar. */
export interface PeriodPerformanceAnalysis {
  base: PeriodBaseResult
  performance: PerformanceReconciliationResult
  /** Ratio del período. No entra en la reconciliación monetaria. */
  periodReturn: PeriodReturnResult
}
