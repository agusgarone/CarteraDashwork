import type { EntityId } from '../domain/common'
import type { CorporateAction } from '../domain/corporateAction'
import type { PortfolioSnapshotAggregate } from '../domain/snapshot'
import type { Transaction } from '../domain/transaction'
import { aggregateExternalFlows, type ExternalFlows } from '../engine/calculations/externalFlows'
import { reconcileExplicitPerformance } from '../engine/calculations/explicitPerformance'
import { calculateExpectedInvestmentResult } from '../engine/calculations/investmentResult'
import type { PerformanceReconciliationResult } from '../engine/models/explicitPerformance'
import type { ParsedConsolidatedPosition } from '../parsers/models/parsedConsolidatedPosition'
import type { ParsedMonthlyAccount } from '../parsers/models/parsedMonthlyAccount'
import type { ParsedMonthlyFundStatement } from '../parsers/models/parsedMonthlyFundStatement'
import { adaptConsolidatedPosition } from './adapters/consolidatedPositionAdapter'
import { adaptMonthlyAccount } from './adapters/monthlyAccountAdapter'
import { enrichFundPositions, type FundEnrichmentResult } from './enrichment/enrichFundPositions'
import { sourceReconciliationDifference } from './sourceReconciliation'

export interface ParsedPeriodInput {
  portfolioId: EntityId
  openingPeriodId: EntityId
  closingPeriodId: EntityId
  createdAt: string
  opening: ParsedConsolidatedPosition
  closing: ParsedConsolidatedPosition
  movements: ParsedMonthlyAccount
  fundStatement: ParsedMonthlyFundStatement
}

/**
 * Modelos ya parseados → dominio → PortfolioEngine.
 * Corre en memoria. No abre SQLite y no es ImportPeriodService.
 * sourceReconciliationDifference viaja al lado del resultado, sin entrar en él.
 */
export interface ParsedPeriodAnalysis {
  opening: PortfolioSnapshotAggregate
  closing: PortfolioSnapshotAggregate
  transactions: Transaction[]
  corporateActions: CorporateAction[]
  flows: ExternalFlows
  investmentResult: string
  performance: PerformanceReconciliationResult
  openingEnrichment: FundEnrichmentResult
  closingEnrichment: FundEnrichmentResult
  openingDocumentDifference: string
  closingDocumentDifference: string
  /** 1.8802 − 0.0962. Sigue siendo el desfase de los PDF de posición, sin el cuotapartista. */
  rawConsolidatedDifferenceChange: string
  sourceReconciliationDifference: string
  /** Diferencia del detalle ya enriquecido. No pisa el diagnóstico crudo. */
  enrichedDetailDifferenceChange: string
}

export function analyzeParsedPeriod(input: ParsedPeriodInput): ParsedPeriodAnalysis {
  const openingEnrichment = enrichFundPositions({
    consolidatedPosition: input.opening,
    fundStatement: input.fundStatement,
    snapshotDate: input.opening.snapshotDate,
    holdingCurrency: 'ARS',
  })
  const closingEnrichment = enrichFundPositions({
    consolidatedPosition: input.closing,
    fundStatement: input.fundStatement,
    snapshotDate: input.closing.snapshotDate,
    holdingCurrency: 'ARS',
  })
  const opening = adaptConsolidatedPosition(openingEnrichment.position, {
    portfolioId: input.portfolioId,
    periodId: input.openingPeriodId,
    createdAt: input.createdAt,
  })
  const closing = adaptConsolidatedPosition(closingEnrichment.position, {
    portfolioId: input.portfolioId,
    periodId: input.closingPeriodId,
    createdAt: input.createdAt,
  })
  const movements = adaptMonthlyAccount(input.movements, {
    portfolioId: input.portfolioId,
    periodId: input.closingPeriodId,
    createdAt: input.createdAt,
  })
  const flows = aggregateExternalFlows(movements.transactions)
  const investmentResult = calculateExpectedInvestmentResult({
    openingValue: opening.snapshot.totalValue,
    closingValue: closing.snapshot.totalValue,
    contributions: flows.contributions,
    withdrawals: flows.withdrawals,
  })
  const performance = reconcileExplicitPerformance({
    expectedResult: investmentResult,
    transactions: movements.transactions,
    openingPositions: opening.positions,
    closingPositions: closing.positions,
    corporateActions: movements.corporateActions,
    currency: closing.snapshot.currency,
    openingCashBalances: opening.cashBalances,
    closingCashBalances: closing.cashBalances,
    baseCurrency: closing.snapshot.currency,
    netContributions: flows.netContributions,
  })
  const openingDocumentDifference = input.opening.reconciliation.difference
  const closingDocumentDifference = input.closing.reconciliation.difference
  const rawConsolidatedDifferenceChange = sourceReconciliationDifference(
    openingDocumentDifference,
    closingDocumentDifference,
  )
  const enrichedDetailDifferenceChange = sourceReconciliationDifference(
    openingEnrichment.enrichedDetail.difference,
    closingEnrichment.enrichedDetail.difference,
  )

  return {
    opening,
    closing,
    transactions: movements.transactions,
    corporateActions: movements.corporateActions,
    flows,
    investmentResult,
    performance,
    openingEnrichment,
    closingEnrichment,
    openingDocumentDifference,
    closingDocumentDifference,
    rawConsolidatedDifferenceChange,
    sourceReconciliationDifference: rawConsolidatedDifferenceChange,
    enrichedDetailDifferenceChange,
  }
}
