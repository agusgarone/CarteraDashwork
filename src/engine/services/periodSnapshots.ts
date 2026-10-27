import type { PortfolioPeriod } from '../../domain/period'
import type { PortfolioSnapshot } from '../../domain/snapshot'
import { AnalysisError, MissingClosingSnapshotError, MissingOpeningSnapshotError, MissingPeriodError } from '../errors/analysisErrors'

export interface PeriodSnapshotDependencies {
  periods: { getById(id: string): Promise<PortfolioPeriod | null> }
  snapshots: {
    getLatestBefore(portfolioId: string, date: string): Promise<PortfolioSnapshot | null>
    getLatestByPeriod(periodId: string): Promise<PortfolioSnapshot | null>
  }
}

/** Canonical monthly boundary resolution, shared by monthly and range analysis.
 * The current schema has no explicit opening_snapshot_id. Do not substitute a lookup
 * of the preceding calendar period's closing snapshot for this monthly relationship.
 */
export async function resolvePeriodSnapshots(periodId: string, repositories: PeriodSnapshotDependencies) {
  const period = await repositories.periods.getById(periodId)
  if (!period) throw new MissingPeriodError(periodId)
  const opening = await repositories.snapshots.getLatestBefore(period.portfolioId, periodStartDate(period))
  if (!opening) throw new MissingOpeningSnapshotError(periodId)
  const closing = await repositories.snapshots.getLatestByPeriod(period.id)
  if (!closing) throw new MissingClosingSnapshotError(periodId)
  if (opening.currency !== closing.currency) throw new AnalysisError(`El snapshot de apertura está en ${opening.currency} y el de cierre en ${closing.currency}.`)
  if (closing.date <= opening.date) throw new AnalysisError('El snapshot de cierre no es posterior al snapshot de apertura.')
  return { period, opening, closing }
}

export function periodStartDate(period: PortfolioPeriod): string {
  if (!Number.isInteger(period.year)) throw new AnalysisError(`El período ${period.id} tiene un año inválido.`)
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) throw new AnalysisError(`El período ${period.id} tiene un mes inválido.`)
  return `${period.year}-${String(period.month).padStart(2, '0')}-01`
}