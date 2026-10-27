import { resolvePeriodSnapshots } from './periodSnapshots'
export { periodStartDate } from './periodSnapshots'
import type { EntityId } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import type { PortfolioPeriod } from '../../domain/period'
import type { PortfolioSnapshot } from '../../domain/snapshot'
import type { Transaction } from '../../domain/transaction'
import { periodRepository } from '../../repositories/periodRepository'
import { snapshotRepository } from '../../repositories/snapshotRepository'
import { transactionRepository } from '../../repositories/transactionRepository'
import { aggregateExternalFlows } from '../calculations/externalFlows'
import { calculateExpectedInvestmentResult } from '../calculations/investmentResult'
import { AnalysisError } from '../errors/analysisErrors'
import { normalizeMonetary } from '../money'
import type { PeriodBaseResult } from '../models/periodBaseResult'

export interface PeriodAnalysisRepositories {
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
      assertExternalFlowsUseCurrency(transactions, closing.currency)

      const openingValue = normalizeMonetary(opening.totalValue)
      const closingValue = normalizeMonetary(closing.totalValue)
      const flows = aggregateExternalFlows(transactions)
      const investmentResult = calculateExpectedInvestmentResult({
        openingValue,
        closingValue,
        contributions: flows.contributions,
        withdrawals: flows.withdrawals,
      })

      return {
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
})

function assertExternalFlowsUseCurrency(
  transactions: readonly Transaction[],
  currency: CurrencyCode,
): void {
  for (const transaction of transactions) {
    if (transaction.type !== 'CONTRIBUTION' && transaction.type !== 'WITHDRAWAL') {
      continue
    }
    if (transaction.currency !== currency) {
      throw new AnalysisError(
        `El movimiento ${transaction.id} está en ${transaction.currency} y el cierre en ${currency}.`,
      )
    }
  }
}
