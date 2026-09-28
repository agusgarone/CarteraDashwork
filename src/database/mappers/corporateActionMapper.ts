import type { CorporateAction } from '../../domain/corporateAction'
import type { CorporateActionRow } from '../rows/corporateActionRow'
import {
  mapCorporateActionType,
  mapId,
  mapNullableDecimal,
  mapNullableId,
  mapNullableText,
} from './values'

export function mapCorporateActionRow(row: CorporateActionRow): CorporateAction {
  return {
    id: mapId(row.id),
    portfolioId: mapId(row.portfolio_id),
    periodId: mapId(row.period_id),
    instrumentId: mapId(row.instrument_id),
    date: row.date,
    type: mapCorporateActionType(row.type),
    quantityBefore: mapNullableDecimal(row.quantity_before),
    quantityChange: mapNullableDecimal(row.quantity_change),
    quantityAfter: mapNullableDecimal(row.quantity_after),
    ratio: mapNullableDecimal(row.ratio),
    description: mapNullableText(row.description),
    sourceDocumentId: mapNullableId(row.source_document_id),
    createdAt: row.created_at,
  }
}
