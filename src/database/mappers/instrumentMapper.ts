import type { Instrument } from '../../domain/instrument'
import type { InstrumentRow } from '../rows/instrumentRow'
import { mapCurrency, mapId, mapInstrumentCategory, mapNullableText } from './values'

export function mapInstrumentRow(row: InstrumentRow): Instrument {
  return {
    id: mapId(row.id),
    ticker: row.ticker,
    name: mapNullableText(row.name),
    category: mapInstrumentCategory(row.category),
    currency: mapCurrency(row.currency),
    brokerIdentifier: mapNullableText(row.broker_identifier),
    createdAt: row.created_at,
  }
}
