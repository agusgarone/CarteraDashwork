import type { PortfolioPeriod } from '../../domain/period'
import type { PeriodRow } from '../rows/periodRow'
import { mapId, mapInteger, mapNullableText, mapPeriodStatus } from './values'

export function mapPeriodRow(row: PeriodRow): PortfolioPeriod {
  return {
    id: mapId(row.id),
    portfolioId: mapId(row.portfolio_id),
    year: mapInteger(row.year, 'Año'),
    month: mapInteger(row.month, 'Mes'),
    status: mapPeriodStatus(row.status),
    createdAt: row.created_at,
    completedAt: mapNullableText(row.completed_at),
  }
}
