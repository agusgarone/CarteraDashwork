import type { CashBalance, PortfolioSnapshot, Position } from '../../domain/snapshot'
import type { CashBalanceRow, PositionRow, SnapshotRow } from '../rows/snapshotRow'
import { mapCurrency, mapDecimal, mapId, mapNullableDecimal, mapNullableId } from './values'

export function mapSnapshotRow(row: SnapshotRow): PortfolioSnapshot {
  return {
    id: mapId(row.id),
    portfolioId: mapId(row.portfolio_id),
    periodId: mapId(row.period_id),
    date: row.date,
    totalValue: mapDecimal(row.total_value),
    currency: mapCurrency(row.currency),
    sourceDocumentId: mapNullableId(row.source_document_id),
    createdAt: row.created_at,
  }
}

export function mapPositionRow(row: PositionRow): Position {
  return {
    id: mapId(row.id),
    snapshotId: mapId(row.snapshot_id),
    instrumentId: mapId(row.instrument_id),
    quantity: mapDecimal(row.quantity),
    unitPrice: mapDecimal(row.unit_price),
    marketValue: mapDecimal(row.market_value),
    currency: mapCurrency(row.currency),
  }
}

export function mapCashBalanceRow(row: CashBalanceRow): CashBalance {
  return {
    id: mapId(row.id),
    snapshotId: mapId(row.snapshot_id),
    currency: mapCurrency(row.currency),
    amount: mapDecimal(row.amount),
    fxRate: mapNullableDecimal(row.fx_rate),
    valueInBaseCurrency: mapNullableDecimal(row.value_in_base_currency),
  }
}
