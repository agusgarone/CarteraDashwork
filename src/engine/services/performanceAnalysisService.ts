import type { EntityId } from '../../domain/common'
import type { CorporateAction } from '../../domain/corporateAction'
import type { CurrencyCode } from '../../domain/currency'
import type { PortfolioPeriod } from '../../domain/period'
import type { PortfolioSnapshot, PortfolioSnapshotAggregate } from '../../domain/snapshot'
import type { Transaction, TransactionType } from '../../domain/transaction'
import { corporateActionRepository } from '../../repositories/corporateActionRepository'
import { periodRepository } from '../../repositories/periodRepository'
import { snapshotRepository } from '../../repositories/snapshotRepository'
import { transactionRepository } from '../../repositories/transactionRepository'
import { reconcileExplicitPerformance } from '../calculations/explicitPerformance'
import {
  AnalysisError,
  MissingClosingSnapshotError,
  MissingOpeningSnapshotError,
  MissingPeriodError,
} from '../errors/analysisErrors'
import type { PeriodPerformanceAnalysis } from '../models/periodPerformance'
import {
  periodAnalysisService,
  periodStartDate,
  type PeriodAnalysisService,
} from './periodAnalysisService'

export interface PerformanceAnalysisDependencies {
  analysis: Pick<PeriodAnalysisService, 'analyzePeriod'>
  periods: {
    getById(id: EntityId): Promise<PortfolioPeriod | null>
  }
  snapshots: {
    getLatestBefore(portfolioId: EntityId, date: string): Promise<PortfolioSnapshot | null>
    getLatestByPeriod(periodId: EntityId): Promise<PortfolioSnapshot | null>
    getAggregate(snapshotId: EntityId): Promise<PortfolioSnapshotAggregate | null>
  }
  transactions: {
    getByPeriod(periodId: EntityId): Promise<Transaction[]>
  }
  corporateActions: {
    getByPeriod(periodId: EntityId): Promise<CorporateAction[]>
  }
}

export interface PerformanceAnalysisService {
  analyzePeriod(periodId: EntityId): Promise<PeriodPerformanceAnalysis>
}

export function createPerformanceAnalysisService(
  dependencies: PerformanceAnalysisDependencies,
): PerformanceAnalysisService {
  return {
    async analyzePeriod(periodId) {
      const base = await dependencies.analysis.analyzePeriod(periodId)
      const closing = await dependencies.snapshots.getLatestByPeriod(periodId)
      if (!closing) {
        throw new MissingClosingSnapshotError(periodId)
      }

      const transactions = await dependencies.transactions.getByPeriod(periodId)
      assertExplicitMovementsUseCurrency(transactions, closing.currency)

      const period = await dependencies.periods.getById(periodId)
      if (!period) {
        throw new MissingPeriodError(periodId)
      }

      const opening = await dependencies.snapshots.getLatestBefore(
        period.portfolioId,
        periodStartDate(period),
      )
      if (!opening) {
        throw new MissingOpeningSnapshotError(periodId)
      }

      const openingAggregate = await dependencies.snapshots.getAggregate(opening.id)
      const closingAggregate = await dependencies.snapshots.getAggregate(closing.id)
      if (!openingAggregate || !closingAggregate) {
        throw new AnalysisError(`No se pudo leer el detalle de los snapshots del período ${periodId}.`)
      }

      const corporateActions = await dependencies.corporateActions.getByPeriod(periodId)

      return {
        base,
        performance: reconcileExplicitPerformance({
          expectedResult: base.investmentResult,
          transactions,
          // La caja queda fuera: su variación, sobre todo por tipo de cambio, se explica después.
          openingPositions: openingAggregate.positions,
          closingPositions: closingAggregate.positions,
          corporateActions,
          currency: closing.currency,
        }),
      }
    },
  }
}

export const performanceAnalysisService = createPerformanceAnalysisService({
  analysis: periodAnalysisService,
  periods: periodRepository,
  snapshots: snapshotRepository,
  transactions: transactionRepository,
  corporateActions: corporateActionRepository,
})

function assertExplicitMovementsUseCurrency(
  transactions: readonly Transaction[],
  currency: CurrencyCode,
): void {
  for (const transaction of transactions) {
    if (!isExplicit(transaction.type)) continue
    if (transaction.currency !== currency) {
      throw new AnalysisError(
        `El movimiento ${transaction.id} (${transaction.type}) está en ${transaction.currency} y el cierre en ${currency}. No hay conversión de moneda.`,
      )
    }
  }
}

function isExplicit(type: TransactionType): boolean {
  return type === 'DIVIDEND' || type === 'INTEREST' || type === 'FEE' || type === 'TAX'
}
