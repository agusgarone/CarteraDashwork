import type { PortfolioPeriod } from '../domain/period'
import type { PortfolioSnapshot } from '../domain/snapshot'
import type { Transaction } from '../domain/transaction'
import type { PeriodFxReference } from '../domain/periodFxReference'
import type { PeriodBaseResult } from '../engine/models/periodBaseResult'
import type { PeriodReturnResult } from '../engine/models/periodReturn'
import { aggregateExternalFlows } from '../engine/calculations/externalFlows'
import { calculateExpectedInvestmentResult } from '../engine/calculations/investmentResult'
import { calculateModifiedDietz } from '../engine/calculations/modifiedDietz'
import { normalizeMonetary } from '../engine/money'
import { daysBetween } from '../engine/calendarDate'
import { AnalysisError } from '../engine/errors/analysisErrors'
import { resolvePeriodSnapshots } from '../engine/services/periodSnapshots'
import { periodRepository, type PeriodRepository } from '../repositories/periodRepository'
import { snapshotRepository, type SnapshotRepository } from '../repositories/snapshotRepository'
import { transactionRepository, type TransactionRepository } from '../repositories/transactionRepository'
import { corporateActionRepository, type CorporateActionRepository } from '../repositories/corporateActionRepository'
import { getPeriodUsdMepReference } from '../services/periodFxReferenceService'
import { resolveAnalysisRange, monthIndex, monthKey, type AnalysisRange, type RangeResolution } from './analysisRange'

export interface RangeInstrument {
  instrumentId: string
  presentAtOpening: boolean
  presentAtClosing: boolean
  hasTransactions: boolean
  hasCorporateActions: boolean
  completeTradeCycle: boolean
}
export interface RangeAnalysisAvailable {
  status: 'AVAILABLE'
  range: AnalysisRange
  periods: PortfolioPeriod[]
  openingSnapshot: PortfolioSnapshot
  closingSnapshot: PortfolioSnapshot
  durationDays: number
  base: PeriodBaseResult
  periodReturn: PeriodReturnResult
  attribution: { status: 'PENDING'; reason: 'MULTI_PERIOD_ATTRIBUTION_NOT_IMPLEMENTED' }
  transactionIds: string[]
  instrumentUniverse: RangeInstrument[]
  evolution: { id: string; label: string; date: string; portfolioValue: string }[]
  usdReference: PeriodFxReference
}
export type RangeAnalysisResult = RangeAnalysisAvailable
  | Exclude<RangeResolution, { status: 'AVAILABLE' }>
  | { status: 'UNAVAILABLE'; reason: string; message?: string }

export interface RangeAnalysisDependencies {
  periods: Pick<PeriodRepository, 'getById' | 'getByPortfolio'>
  snapshots: Pick<SnapshotRepository, 'getLatestBefore' | 'getLatestByPeriod' | 'getPositions'>
  transactions: Pick<TransactionRepository, 'getByPeriod'>
  corporateActions: Pick<CorporateActionRepository, 'getByPeriod'>
  getUsdReference: (periodId: string) => Promise<PeriodFxReference>
}

export function createRangeAnalysisService(dependencies: RangeAnalysisDependencies) {
  return {
    async analyzeRange(range: AnalysisRange): Promise<RangeAnalysisResult> {
      const first = await dependencies.periods.getById(range.startPeriodId)
      const last = await dependencies.periods.getById(range.endPeriodId)
      if (!first || !last || first.portfolioId !== last.portfolioId) return { status: 'UNAVAILABLE', reason: 'INVALID_RANGE_ENDPOINTS' }
      const available = (await dependencies.periods.getByPortfolio(first.portfolioId)).filter(period => period.status === 'COMPLETE')
      const resolution = resolveAnalysisRange(available, { mode: 'CUSTOM', customStartPeriodId: first.id, endPeriodId: last.id })
      if (resolution.status !== 'AVAILABLE') return resolution
      const included = resolution.periods.map(row => available.find(period => period.id === row.id)!)
      const boundaries: Awaited<ReturnType<typeof resolvePeriodSnapshots>>[] = []
      try {
        for (const period of included) {
          const boundary = await resolvePeriodSnapshots(period.id, dependencies)
          if (boundary.closing.date.slice(0, 7) !== monthKey(monthIndex(period))) return { status: 'UNAVAILABLE', reason: 'CLOSING_SNAPSHOT_OUTSIDE_PERIOD' }
          const previous = boundaries[boundaries.length - 1]
          if (previous && previous.closing.id !== boundary.opening.id) return { status: 'UNAVAILABLE', reason: 'BROKEN_SNAPSHOT_CHAIN' }
          boundaries.push(boundary)
        }
      } catch (error) {
        if (error instanceof AnalysisError) return { status: 'UNAVAILABLE', reason: 'SNAPSHOT_UNAVAILABLE', message: error.message }
        throw error
      }
      const opening = boundaries[0]!.opening
      const closing = boundaries[boundaries.length - 1]!.closing
      if (opening.date.slice(0, 7) !== monthKey(monthIndex(first) - 1)) return { status: 'UNAVAILABLE', reason: 'MISSING_OPENING_BOUNDARY' }
      const uniqueTransactions = new Map<string, Transaction>()
      const actions: Awaited<ReturnType<CorporateActionRepository['getByPeriod']>> = []
      for (const period of included) {
        for (const transaction of await dependencies.transactions.getByPeriod(period.id)) {
          if (transaction.portfolioId !== first.portfolioId || transaction.periodId !== period.id) return { status: 'UNAVAILABLE', reason: 'TRANSACTION_PERIOD_MISMATCH' }
          if (transaction.date < opening.date || transaction.date > closing.date) return { status: 'UNAVAILABLE', reason: 'TRANSACTION_OUTSIDE_RANGE' }
          uniqueTransactions.set(transaction.id, transaction)
        }
        actions.push(...await dependencies.corporateActions.getByPeriod(period.id))
      }
      const transactions = [...uniqueTransactions.values()]
      if (transactions.some(row => (row.type === 'CONTRIBUTION' || row.type === 'WITHDRAWAL') && row.currency !== closing.currency)) return { status: 'UNAVAILABLE', reason: 'EXTERNAL_FLOW_CURRENCY_MISMATCH' }
      const flows = aggregateExternalFlows(transactions)
      const openingValue = normalizeMonetary(opening.totalValue)
      const closingValue = normalizeMonetary(closing.totalValue)
      const investmentResult = calculateExpectedInvestmentResult({ openingValue, closingValue, contributions: flows.contributions, withdrawals: flows.withdrawals })
      const base = { openingValue, closingValue, ...flows, investmentResult }
      const periodReturn = calculateModifiedDietz({ investmentResult, openingValue, openingDate: opening.date, closingDate: closing.date, transactions })
      const openingPositions = await dependencies.snapshots.getPositions(opening.id)
      const closingPositions = await dependencies.snapshots.getPositions(closing.id)
      const ids = new Set([...openingPositions.map(row => row.instrumentId), ...closingPositions.map(row => row.instrumentId),
        ...transactions.map(row => row.instrumentId).filter((id): id is string => id !== null), ...actions.map(row => row.instrumentId)])
      const instrumentUniverse = [...ids].map(instrumentId => {
        const own = transactions.filter(row => row.instrumentId === instrumentId)
        const presentAtOpening = openingPositions.some(row => row.instrumentId === instrumentId)
        const presentAtClosing = closingPositions.some(row => row.instrumentId === instrumentId)
        return { instrumentId, presentAtOpening, presentAtClosing, hasTransactions: own.length > 0,
          hasCorporateActions: actions.some(row => row.instrumentId === instrumentId),
          completeTradeCycle: !presentAtOpening && !presentAtClosing && own.some(row => row.type === 'BUY') && own.some(row => row.type === 'SELL') }
      })
      return {
        status: 'AVAILABLE', range, periods: included, openingSnapshot: opening, closingSnapshot: closing,
        durationDays: daysBetween(opening.date, closing.date), base, periodReturn,
        attribution: { status: 'PENDING', reason: 'MULTI_PERIOD_ATTRIBUTION_NOT_IMPLEMENTED' },
        transactionIds: transactions.map(row => row.id), instrumentUniverse,
        evolution: boundaries.map(({ period, closing: snapshot }) => ({ id: period.id, label: `${String(period.month).padStart(2, '0')}/${period.year}`, date: snapshot.date, portfolioValue: snapshot.totalValue })),
        usdReference: await dependencies.getUsdReference(last.id),
      }
    },
  }
}

export const rangeAnalysisService = createRangeAnalysisService({
  periods: periodRepository, snapshots: snapshotRepository, transactions: transactionRepository,
  corporateActions: corporateActionRepository, getUsdReference: getPeriodUsdMepReference,
})