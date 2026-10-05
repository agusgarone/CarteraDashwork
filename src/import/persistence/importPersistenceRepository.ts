import type { DatabaseClient, TransactionParam, TransactionStatement } from '../../database/client'
import type { EntityId } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import type { DocumentType } from '../../domain/document'
import type { InstrumentCategory } from '../../domain/instrument'

export type FieldName = 'quantity' | 'unit_price' | 'market_value'

export interface ImportIdRef {
  existingId: string | null
}

export interface ImportPeriodRow extends ImportIdRef {
  key: string
  year: number
  month: number
  /** El período analizado pasa a COMPLETE. Un período solo usado como apertura queda PENDING. */
  completes: boolean
}

export interface ImportDocumentRow extends ImportIdRef {
  key: string
  periodKey: string
  type: DocumentType
  originalFilename: string
  localPath: string
  sha256: string
  parserVersion: string
}

export interface ImportInstrumentRow extends ImportIdRef {
  key: string
  ticker: string
  name: string | null
  category: InstrumentCategory
  currency: CurrencyCode
}

export interface ImportFieldSourceRow {
  field: FieldName
  documentKey: string
  sourceReference: string | null
  asOfDate: string
}

export interface ImportPositionRow {
  instrumentKey: string
  quantity: string
  unitPrice: string
  marketValue: string
  currency: CurrencyCode
  sources: ImportFieldSourceRow[]
}

export interface ImportCashRow {
  currency: CurrencyCode
  amount: string
  fxRate: string | null
  valueInBaseCurrency: string | null
}

export interface ImportSnapshotRow {
  key: string
  periodKey: string
  documentKey: string
  date: string
  totalValue: string
  currency: CurrencyCode
  existingId: string | null
  positions: ImportPositionRow[]
  cash: ImportCashRow[]
  rawDifference: string
  enrichedDifference: string
}

export interface ImportTransactionRow {
  instrumentKey: string | null
  documentKey: string
  date: string
  type: string
  quantity: string | null
  unitPrice: string | null
  grossAmount: string | null
  netAmount: string | null
  fees: string | null
  taxes: string | null
  currency: CurrencyCode
  fxRate: string | null
  sourceReference: string | null
}

export interface ImportCorporateActionRow {
  instrumentKey: string
  documentKey: string
  date: string
  type: string
  quantityBefore: string | null
  quantityChange: string | null
  quantityAfter: string | null
  ratio: string | null
  description: string | null
}

export interface ImportPersistencePlan {
  portfolioId: EntityId
  completedAt: string
  periods: ImportPeriodRow[]
  documents: ImportDocumentRow[]
  instruments: ImportInstrumentRow[]
  snapshots: ImportSnapshotRow[]
  transactions: ImportTransactionRow[]
  corporateActions: ImportCorporateActionRow[]
}

export interface CompiledImport {
  statements: TransactionStatement[]
  closingPeriod: ImportIdRef & { statementIndex: number | null }
  openingSnapshotId: ImportIdRef & { statementIndex: number | null }
  closingSnapshotId: ImportIdRef & { statementIndex: number | null }
}

/**
 * Una sola transacción para el período importado.
 * Si una sentencia falla, SQLite revierte todas las de esta lista.
 */
export function compileImportPlan(plan: ImportPersistencePlan): CompiledImport {
  const statements: TransactionStatement[] = []
  const periodIndex = new Map<string, number>()
  const documentIndex = new Map<string, number>()
  const instrumentIndex = new Map<string, number>()
  const snapshotIndex = new Map<string, number>()

  for (const period of plan.periods) {
    if (period.existingId) continue
    const status = period.completes ? 'PROCESSING' : 'PENDING'
    periodIndex.set(
      period.key,
      push(statements, {
        sql: `INSERT INTO periods (portfolio_id, year, month, status) VALUES ($1, $2, $3, $4)`,
        params: [plan.portfolioId, period.year, period.month, status],
      }),
    )
  }

  for (const document of plan.documents) {
    if (document.existingId) continue
    documentIndex.set(
      document.key,
      push(statements, {
        sql: `INSERT INTO documents (
                period_id, type, original_filename, local_path, sha256, processing_status, parser_version
              ) VALUES ($1, $2, $3, $4, $5, 'PROCESSED', $6)`,
        params: [
          ref(periodIndex, plan.periods, document.periodKey),
          document.type,
          document.originalFilename,
          document.localPath,
          document.sha256,
          document.parserVersion,
        ],
      }),
    )
  }

  for (const instrument of plan.instruments) {
    if (instrument.existingId) continue
    instrumentIndex.set(
      instrument.key,
      push(statements, {
        sql: `INSERT INTO instruments (ticker, name, category, currency, broker_identifier)
              VALUES ($1, $2, $3, $4, NULL)`,
        params: [instrument.ticker, instrument.name, instrument.category, instrument.currency],
      }),
    )
  }

  for (const snapshot of plan.snapshots) {
    if (snapshot.existingId) continue
    const snapshotStatement = push(statements, {
      sql: `INSERT INTO snapshots (
              portfolio_id, period_id, date, total_value, currency, source_document_id
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
      params: [
        plan.portfolioId,
        ref(periodIndex, plan.periods, snapshot.periodKey),
        snapshot.date,
        snapshot.totalValue,
        snapshot.currency,
        ref(documentIndex, plan.documents, snapshot.documentKey),
      ],
    })
    snapshotIndex.set(snapshot.key, snapshotStatement)

    for (const cash of snapshot.cash) {
      push(statements, {
        sql: `INSERT INTO cash_balances (
                snapshot_id, currency, amount, fx_rate, value_in_base_currency
              ) VALUES ($1, $2, $3, $4, $5)`,
        params: [
          { lastInsertIdOf: snapshotStatement },
          cash.currency,
          cash.amount,
          cash.fxRate,
          cash.valueInBaseCurrency,
        ],
      })
    }

    for (const position of snapshot.positions) {
      const positionStatement = push(statements, {
        sql: `INSERT INTO positions (
                snapshot_id, instrument_id, quantity, unit_price, market_value, currency
              ) VALUES ($1, $2, $3, $4, $5, $6)`,
        params: [
          { lastInsertIdOf: snapshotStatement },
          ref(instrumentIndex, plan.instruments, position.instrumentKey),
          position.quantity,
          position.unitPrice,
          position.marketValue,
          position.currency,
        ],
      })
      for (const source of position.sources) {
        push(statements, {
          sql: `INSERT INTO position_field_sources (
                  position_id, field_name, document_id, source_reference, as_of_date
                ) VALUES ($1, $2, $3, $4, $5)`,
          params: [
            { lastInsertIdOf: positionStatement },
            source.field,
            ref(documentIndex, plan.documents, source.documentKey),
            source.sourceReference,
            source.asOfDate,
          ],
        })
      }
    }

    push(statements, {
      sql: `INSERT INTO snapshot_source_reconciliations (
              snapshot_id, raw_difference, enriched_difference
            ) VALUES ($1, $2, $3)`,
      params: [
        { lastInsertIdOf: snapshotStatement },
        snapshot.rawDifference,
        snapshot.enrichedDifference,
      ],
    })
  }

  for (const movement of plan.transactions) {
    push(statements, {
      sql: `INSERT INTO transactions (
              portfolio_id, period_id, instrument_id, date, type, quantity, unit_price,
              gross_amount, net_amount, fees, taxes, currency, fx_rate, source_document_id, source_reference
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      params: [
        plan.portfolioId,
        ref(periodIndex, plan.periods, 'closing'),
        movement.instrumentKey
          ? ref(instrumentIndex, plan.instruments, movement.instrumentKey)
          : null,
        movement.date,
        movement.type,
        movement.quantity,
        movement.unitPrice,
        movement.grossAmount,
        movement.netAmount,
        movement.fees,
        movement.taxes,
        movement.currency,
        movement.fxRate,
        ref(documentIndex, plan.documents, movement.documentKey),
        movement.sourceReference,
      ],
    })
  }

  for (const action of plan.corporateActions) {
    push(statements, {
      sql: `INSERT INTO corporate_actions (
              portfolio_id, period_id, instrument_id, date, type,
              quantity_before, quantity_change, quantity_after, ratio, description, source_document_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      params: [
        plan.portfolioId,
        ref(periodIndex, plan.periods, 'closing'),
        ref(instrumentIndex, plan.instruments, action.instrumentKey),
        action.date,
        action.type,
        action.quantityBefore,
        action.quantityChange,
        action.quantityAfter,
        action.ratio,
        action.description,
        ref(documentIndex, plan.documents, action.documentKey),
      ],
    })
  }

  for (const period of plan.periods) {
    if (!period.completes) continue
    const id = period.existingId
      ? period.existingId
      : { lastInsertIdOf: requiredIndex(periodIndex, period.key) }
    push(statements, {
      sql: `UPDATE periods SET status = 'COMPLETE', completed_at = $1 WHERE id = $2 AND status != 'ERROR'`,
      params: [plan.completedAt, id],
    })
  }

  return {
    statements,
    closingPeriod: pointer(plan.periods, periodIndex, 'closing'),
    openingSnapshotId: pointer(plan.snapshots, snapshotIndex, 'opening'),
    closingSnapshotId: pointer(plan.snapshots, snapshotIndex, 'closing'),
  }
}

export async function persistImportPlan(
  db: DatabaseClient,
  plan: ImportPersistencePlan,
): Promise<{ closingPeriodId: string; openingSnapshotId: string; closingSnapshotId: string }> {
  const compiled = compileImportPlan(plan)
  const result = await db.transaction(compiled.statements)
  return {
    closingPeriodId: resolveRef(compiled.closingPeriod, result.lastInsertIds),
    openingSnapshotId: resolveRef(compiled.openingSnapshotId, result.lastInsertIds),
    closingSnapshotId: resolveRef(compiled.closingSnapshotId, result.lastInsertIds),
  }
}

function push(statements: TransactionStatement[], statement: TransactionStatement): number {
  statements.push(statement)
  return statements.length - 1
}

function ref(
  inserted: Map<string, number>,
  rows: readonly (ImportIdRef & { key: string })[],
  key: string,
): TransactionParam {
  const existing = rows.find((row) => row.key === key)?.existingId
  if (existing) return existing
  return { lastInsertIdOf: requiredIndex(inserted, key) }
}

function requiredIndex(inserted: Map<string, number>, key: string): number {
  const index = inserted.get(key)
  if (index === undefined) {
    throw new Error(`No hay insert previo para ${key}`)
  }
  return index
}

function pointer(
  rows: readonly (ImportIdRef & { key: string })[],
  inserted: Map<string, number>,
  key: string,
): ImportIdRef & { statementIndex: number | null } {
  const existingId = rows.find((row) => row.key === key)?.existingId ?? null
  return {
    existingId,
    statementIndex: existingId ? null : (inserted.get(key) ?? null),
  }
}

function resolveRef(ref: ImportIdRef & { statementIndex: number | null }, ids: number[]): string {
  if (ref.existingId) return ref.existingId
  const id = ref.statementIndex === null ? undefined : ids[ref.statementIndex]
  if (id === undefined) {
    throw new Error('La transacción no devolvió el id insertado')
  }
  return String(id)
}
