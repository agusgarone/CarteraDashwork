import type { Transaction } from '../../domain/transaction'
import type { TransactionRow } from '../rows/transactionRow'
import {
  mapCurrency,
  mapId,
  mapNullableDecimal,
  mapNullableId,
  mapNullableText,
  mapTransactionType,
} from './values'

export function mapTransactionRow(row: TransactionRow): Transaction {
  return {
    id: mapId(row.id),
    portfolioId: mapId(row.portfolio_id),
    periodId: mapId(row.period_id),
    instrumentId: mapNullableId(row.instrument_id),
    date: row.date,
    type: mapTransactionType(row.type),
    quantity: mapNullableDecimal(row.quantity),
    unitPrice: mapNullableDecimal(row.unit_price),
    grossAmount: mapNullableDecimal(row.gross_amount),
    netAmount: mapNullableDecimal(row.net_amount),
    fees: mapNullableDecimal(row.fees),
    taxes: mapNullableDecimal(row.taxes),
    currency: mapCurrency(row.currency),
    fxRate: mapNullableDecimal(row.fx_rate),
    sourceDocumentId: mapNullableId(row.source_document_id),
    sourceReference: mapNullableText(row.source_reference),
    createdAt: row.created_at,
  }
}
