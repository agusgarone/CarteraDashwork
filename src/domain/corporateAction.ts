import type { DecimalString, EntityId } from './common'

export type CorporateActionType =
  | 'STOCK_DIVIDEND'
  | 'SPLIT'
  | 'REVERSE_SPLIT'
  | 'RATIO_CHANGE'
  | 'OTHER'

/**
 * Evento que cambia la cantidad de una posición sin ser compra ni venta.
 *
 * Un cambio de cantidad no implica necesariamente una operación de mercado.
 * Ejemplos: split, reverse split, dividendo en acciones, cambio de ratio.
 * Separarlo de Transaction es necesario para la reconciliación futura.
 */
export interface CorporateAction {
  id: EntityId

  portfolioId: EntityId
  periodId: EntityId
  instrumentId: EntityId

  date: string

  type: CorporateActionType

  quantityBefore: DecimalString | null
  quantityChange: DecimalString | null
  quantityAfter: DecimalString | null

  ratio: DecimalString | null

  description: string | null

  sourceDocumentId: EntityId | null

  createdAt: string
}
