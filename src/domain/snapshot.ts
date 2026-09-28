import type { DecimalString, EntityId } from './common'
import type { CurrencyCode } from './currency'

/**
 * Estado general de la cartera en una fecha.
 * Positions y cash balances se persisten en tablas propias: este modelo
 * no los incluye como arrays.
 */
export interface PortfolioSnapshot {
  id: EntityId

  portfolioId: EntityId
  periodId: EntityId

  date: string

  totalValue: DecimalString
  currency: CurrencyCode

  sourceDocumentId: EntityId | null

  createdAt: string
}

/** Tenencia de un instrumento dentro de un snapshot. */
export interface Position {
  id: EntityId

  snapshotId: EntityId
  instrumentId: EntityId

  quantity: DecimalString
  unitPrice: DecimalString
  marketValue: DecimalString

  currency: CurrencyCode
}

/** Saldo de caja de un snapshot, en una moneda. */
export interface CashBalance {
  id: EntityId

  snapshotId: EntityId

  currency: CurrencyCode

  amount: DecimalString

  fxRate: DecimalString | null
  valueInBaseCurrency: DecimalString | null
}

/**
 * Snapshot completo en memoria.
 * No reemplaza la forma persistida de PortfolioSnapshot.
 */
export interface PortfolioSnapshotAggregate {
  snapshot: PortfolioSnapshot
  positions: Position[]
  cashBalances: CashBalance[]
}
