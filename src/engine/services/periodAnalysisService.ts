import { valueExternalFlows, PendingExternalFlowFxError } from '../calculations/externalFlowValuation'
import { transactionFxRepository, type StoredTransactionFx } from '../../repositories/transactionFxRepository'
import { resolvePeriodSnapshots } from './periodSnapshots'
export { periodStartDate } from './periodSnapshots'
import type { EntityId } from '../../domain/common'
import type { PortfolioPeriod } from '../../domain/period'
import type { PortfolioSnapshot } from '../../domain/snapshot'
import type { Transaction } from '../../domain/transaction'
import { periodRepository } from '../../repositories/periodRepository'
import { snapshotRepository } from '../../repositories/snapshotRepository'
import { transactionRepository } from '../../repositories/transactionRepository'
import { aggregateExternalFlows } from '../calculations/externalFlows'
import { calculateExpectedInvestmentResult } from '../calculations/investmentResult'
import { normalizeMonetary } from '../money'
import type { PeriodBaseResult } from '../models/periodBaseResult'

export interface PeriodAnalysisRepositories {
  fxEnrichments?: { getByPeriod(periodId: EntityId): Promise<StoredTransactionFx[]> }
  periods: {
    getById(id: EntityId): Promise<PortfolioPeriod | null>
  }
  snapshots: {
    getLatestBefore(portfolioId: EntityId, date: string): Promise<PortfolioSnapshot | null>
    getLatestByPeriod(periodId: EntityId): Promise<PortfolioSnapshot | null>
  }
  transactions: {
    getByPeriod(periodId: EntityId): Promise<Transaction[]>
  }
}

export interface PeriodAnalysisService {
  analyzePeriod(periodId: EntityId): Promise<PeriodBaseResult>
}

export function createPeriodAnalysisService(
  repositories: PeriodAnalysisRepositories,
): PeriodAnalysisService {
  return {
    async analyzePeriod(periodId) {
      const { period, opening, closing } = await resolvePeriodSnapshots(periodId, repositories)

      const transactions = await repositories.transactions.getByPeriod(period.id)

      const openingValue = normalizeMonetary(opening.totalValue)
      const closingValue = normalizeMonetary(closing.totalValue)
      const valuation = valueExternalFlows(transactions, closing.currency, await repositories.fxEnrichments?.getByPeriod(period.id))
      if (valuation.status === 'PENDING_EXTERNAL_FLOW_FX') throw new PendingExternalFlowFxError(valuation, openingValue, closingValue)
      const flows = aggregateExternalFlows(transactions, valuation.valuations)
      const investmentResult = calculateExpectedInvestmentResult({
        openingValue,
        closingValue,
        contributions: flows.contributions,
        withdrawals: flows.withdrawals,
      })

      return {
        ...(valuation.valuations.some(row => row.currency !== row.baseCurrency) ? { externalFlowValuations: valuation.valuations } : {}),
        openingValue,
        closingValue,
        contributions: flows.contributions,
        withdrawals: flows.withdrawals,
        netContributions: flows.netContributions,
        investmentResult,
      }
    },
  }
}

export const periodAnalysisService = createPeriodAnalysisService({
  periods: periodRepository,
  snapshots: snapshotRepository,
  transactions: transactionRepository,
  fxEnrichments: transactionFxRepository,
})
