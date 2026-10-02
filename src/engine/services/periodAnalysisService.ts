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
import {
  AnalysisError,
  MissingClosingSnapshotError,
  MissingOpeningSnapshotError,
  MissingPeriodError,
} from '../errors/analysisErrors'
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
      const period = await repositories.periods.getById(periodId)
      if (!period) {
        throw new MissingPeriodError(periodId)
      }

      const opening = await repositories.snapshots.getLatestBefore(
        period.portfolioId,
        periodStartDate(period),
      )
      if (!opening) {
        throw new MissingOpeningSnapshotError(periodId)
      }

      const closing = await repositories.snapshots.getLatestByPeriod(period.id)
      if (!closing) {
        throw new MissingClosingSnapshotError(periodId)
      }

      if (opening.currency !== closing.currency) {
        throw new AnalysisError(
          `El snapshot de apertura está en ${opening.currency} y el de cierre en ${closing.currency}.`,
        )
      }

      if (closing.date <= opening.date) {
        throw new AnalysisError(
          'El snapshot de cierre no es posterior al snapshot de apertura.',
        )
      }

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

/** Primer día del mes. Los snapshots de esa fecha pertenecen al período, no a la apertura. */
export function periodStartDate(period: PortfolioPeriod): string {
  if (!Number.isInteger(period.year)) {
    throw new AnalysisError(`El período ${period.id} tiene un año inválido.`)
  }
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
    throw new AnalysisError(`El período ${period.id} tiene un mes inválido.`)
  }
  const month = String(period.month).padStart(2, '0')
  return `${period.year}-${month}-01`
}

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
