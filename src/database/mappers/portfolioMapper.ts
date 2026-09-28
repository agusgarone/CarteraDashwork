import type { Portfolio } from '../../domain/portfolio'
import type { PortfolioRow } from '../rows/portfolioRow'
import { mapCurrency, mapId } from './values'

export function mapPortfolioRow(row: PortfolioRow): Portfolio {
  return {
    id: mapId(row.id),
    name: row.name,
    broker: row.broker,
    baseCurrency: mapCurrency(row.base_currency),
    createdAt: row.created_at,
  }
}
