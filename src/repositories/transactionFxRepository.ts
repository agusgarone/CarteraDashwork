import type { DatabaseClient } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import type { EntityId } from '../domain/common'
import type { CurrencyCode } from '../domain/currency'
import type { TransactionType } from '../domain/transaction'
import { persist } from '../database/errors'
import type { PeriodResultsFxKind } from '../parsers/models/parsedPeriodResults'
import type { PlannedTransactionFx, TransactionFxTarget } from '../import/enrichment/periodResultsEnrichment'

export interface StoredTransactionFx {
  transactionId: EntityId
  fxRate: string
  fxKind: PeriodResultsFxKind
  fxDate: string
  sourceDocumentId: EntityId
  sourceSheet: string
  sourceRow: number
  sourceColumn: string
  operationReference: string | null
}

export interface TransactionFxRepository {
  getByPeriod(periodId: EntityId): Promise<StoredTransactionFx[]>
  targetsByPeriod(periodId: EntityId): Promise<TransactionFxTarget[]>
  saveIfMissing(sourceDocumentId: EntityId, rows: readonly PlannedTransactionFx[]): Promise<void>
}

export function createTransactionFxRepository(db: DatabaseClient): TransactionFxRepository {
  return {
    getByPeriod(periodId) {
      return persist('transactionFx.getByPeriod', async () => {
        const rows = await db.select<{
          transaction_id: number
          fx_rate: string
          fx_kind: PeriodResultsFxKind
          fx_date: string
          source_document_id: number
          source_sheet: string
          source_row: number
          source_column: string
          operation_reference: string | null
        }>(
          `SELECT enrichment.transaction_id, enrichment.fx_rate, enrichment.fx_kind, enrichment.fx_date,
                  enrichment.source_document_id, enrichment.source_sheet, enrichment.source_row,
                  enrichment.source_column, enrichment.operation_reference
           FROM transaction_fx_enrichments enrichment
           JOIN transactions ON transactions.id = enrichment.transaction_id
           WHERE transactions.period_id = $1`,
          [periodId],
        )
        return rows.map((row) => ({
          transactionId: String(row.transaction_id),
          fxRate: row.fx_rate,
          fxKind: row.fx_kind,
          fxDate: row.fx_date,
          sourceDocumentId: String(row.source_document_id),
          sourceSheet: row.source_sheet,
          sourceRow: row.source_row,
          sourceColumn: row.source_column,
          operationReference: row.operation_reference,
        }))
      })
    },

    targetsByPeriod(periodId) {
      return persist('transactionFx.targetsByPeriod', async () => {
        const rows = await db.select<{
          id: number
          type: TransactionType
          date: string
          ticker: string | null
          currency: CurrencyCode
          source_reference: string | null
        }>(
          `SELECT transactions.id, transactions.type, transactions.date, instruments.ticker,
                  transactions.currency, transactions.source_reference
           FROM transactions
           LEFT JOIN instruments ON instruments.id = transactions.instrument_id
           WHERE transactions.period_id = $1`,
          [periodId],
        )
        return rows.map((row) => ({
          id: String(row.id),
          type: row.type,
          date: row.date,
          ticker: row.ticker,
          currency: row.currency,
          sourceReference: row.source_reference,
        }))
      })
    },

    saveIfMissing(sourceDocumentId, rows) {
      return persist('transactionFx.saveIfMissing', async () => {
        const statements = rows.map((row) => ({
          sql: `INSERT INTO transaction_fx_enrichments (
                  transaction_id, fx_rate, fx_kind, fx_date, source_document_id,
                  source_sheet, source_row, source_column, operation_reference
                )
                SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
                WHERE NOT EXISTS (
                  SELECT 1 FROM transaction_fx_enrichments WHERE transaction_id = $10
                )`,
          params: [
            row.transactionId,
            row.fxRate,
            row.fxKind,
            row.fxDate,
            sourceDocumentId,
            row.sourceSheet,
            row.sourceRow,
            row.sourceColumn,
            row.operationReference,
            row.transactionId,
          ],
        }))
        if (statements.length === 0) return
        await db.transaction(statements)
      })
    },
  }
}

export const transactionFxRepository = createTransactionFxRepository(getAppDatabaseClient())
