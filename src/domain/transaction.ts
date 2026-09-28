import type { DecimalString, EntityId } from './common'
import type { CurrencyCode } from './currency'

/**
 * Movimiento económico persistido.
 *
 * CONTRIBUTION y WITHDRAWAL son exclusivamente flujos externos de la cartera.
 * BUY y SELL son operaciones sobre instrumentos: una compra no es un aporte
 * y una venta no es un retiro.
 *
 * Los cambios de cantidad por split, dividendo en acciones o cambio de ratio
 * no van acá. Tienen su propia entidad, CorporateAction.
 */
export type TransactionType =
  | 'CONTRIBUTION'
  | 'WITHDRAWAL'
  | 'BUY'
  | 'SELL'
  | 'DIVIDEND'
  | 'INTEREST'
  | 'FUND_SUBSCRIPTION'
  | 'FUND_REDEMPTION'
  | 'FEE'
  | 'TAX'
  | 'FX_CONVERSION'
  | 'OTHER'

export interface Transaction {
  id: EntityId

  portfolioId: EntityId
  periodId: EntityId

  instrumentId: EntityId | null

  date: string

  type: TransactionType

  quantity: DecimalString | null
  unitPrice: DecimalString | null

  grossAmount: DecimalString | null
  netAmount: DecimalString | null

  fees: DecimalString | null
  taxes: DecimalString | null

  currency: CurrencyCode

  fxRate: DecimalString | null

  sourceDocumentId: EntityId | null
  sourceReference: string | null

  createdAt: string
}
