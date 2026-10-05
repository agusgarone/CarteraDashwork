export { reconcileCash } from './calculations/cashReconciliation'
export type { CashReconciliationInput } from './calculations/cashReconciliation'
export {
  calculateExplainedResult,
  calculateExplicitPerformanceBreakdown,
  calculateUnexplainedDifference,
  reconcileExplicitPerformance,
} from './calculations/explicitPerformance'
export {
  analyzePositionValuations,
  calculateStablePositionValuation,
  calculateTotalValuationChange,
} from './calculations/positionValuation'
export type {
  PositionValuationInput,
  StablePositionInput,
} from './calculations/positionValuation'
export type { ExplicitPerformanceInput } from './calculations/explicitPerformance'
export { calculateModifiedDietz } from './calculations/modifiedDietz'
export type { ModifiedDietzInput } from './calculations/modifiedDietz'
export { aggregateExternalFlows, resolveExternalFlowAmount } from './calculations/externalFlows'
export type { ExternalFlows } from './calculations/externalFlows'
export {
  calculateExpectedInvestmentResult,
  calculateNetContributions,
} from './calculations/investmentResult'
export type { InvestmentResultInput } from './calculations/investmentResult'
export {
  AnalysisError,
  MissingClosingSnapshotError,
  MissingOpeningSnapshotError,
  MissingPeriodError,
  MissingTransactionAmountError,
} from './errors/analysisErrors'
export type {
  CashAmountStatus,
  CashAttributionBreakdown,
  CashCurrencyAttribution,
  CashCurrencyStatus,
  CashReconciliationResult,
  CashReconciliationStatus,
  CashValueAttributionStatus,
  CashValuationResult,
} from './models/cashReconciliation'
export type {
  ExplicitPerformanceBreakdown,
  PerformanceBreakdown,
  PerformanceReconciliationResult,
} from './models/explicitPerformance'
export type {
  PositionValuationResult,
  PositionValuationStatus,
} from './models/positionValuation'
export type { PeriodReturnResult } from './models/periodReturn'
export type { PeriodBaseResult } from './models/periodBaseResult'
export type { PeriodPerformanceAnalysis } from './models/periodPerformance'
export { ENGINE_VERSION } from './version'
export {
  createPerformanceAnalysisService,
  performanceAnalysisService,
} from './services/performanceAnalysisService'
export type {
  PerformanceAnalysisDependencies,
  PerformanceAnalysisService,
} from './services/performanceAnalysisService'
export {
  createPeriodAnalysisService,
  periodAnalysisService,
} from './services/periodAnalysisService'
export type {
  PeriodAnalysisRepositories,
  PeriodAnalysisService,
} from './services/periodAnalysisService'
