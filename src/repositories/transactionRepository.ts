import type { DatabaseClient } from '../database/client'
import { insertedId } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { RepositoryError, persist } from '../database/errors'
import { mapTransactionRow } from '../database/mappers/transactionMapper'
import type { TransactionRow } from '../database/rows/transactionRow'
import type { EntityId } from '../domain/common'
import type { Transaction } from '../domain/transaction'

export type CreateTransactionInput = Omit<Transaction, 'id' | 'createdAt'>

const COLUMNS = `id, portfolio_id, period_id, instrument_id, date, type,
  quantity, unit_price, gross_amount, net_amount, fees, taxes,
  currency, fx_rate, source_document_id, source_reference, created_at`

export interface TransactionRepository {
  getById(id: EntityId): Promise<Transaction | null>
  getByPeriod(periodId: EntityId): Promise<Transaction[]>
  getByPortfolio(portfolioId: EntityId): Promise<Transaction[]>
  getByInstrument(instrumentId: EntityId): Promise<Transaction[]>
  getByInstrumentAndPeriod(instrumentId: EntityId, periodId: EntityId): Promise<Transaction[]>
  create(input: CreateTransactionInput): Promise<Transaction>
}

export function createTransactionRepository(db: DatabaseClient): TransactionRepository {
  async function findById(id: EntityId): Promise<Transaction | null> {
    const row = await db.selectOne<TransactionRow>(
      `SELECT ${COLUMNS} FROM transactions WHERE id = $1`,
      [id],
    )
    return row ? mapTransactionRow(row) : null
  }

  async function findWhere(where: string, params: Array<string | number | null>): Promise<Transaction[]> {
    const rows = await db.select<TransactionRow>(
      `SELECT ${COLUMNS}
       FROM transactions
       WHERE ${where}
       ORDER BY date ASC, id ASC`,
      params,
    )
    return rows.map(mapTransactionRow)
  }

  return {
    getById(id) {
      return persist('transaction.getById', () => findById(id))
    },

    getByPeriod(periodId) {
      return persist('transaction.getByPeriod', () => findWhere('period_id = $1', [periodId]))
    },

    getByPortfolio(portfolioId) {
      return persist('transaction.getByPortfolio', () =>
        findWhere('portfolio_id = $1', [portfolioId]),
      )
    },

    getByInstrument(instrumentId) {
      return persist('transaction.getByInstrument', () =>
        findWhere('instrument_id = $1', [instrumentId]),
      )
    },

    getByInstrumentAndPeriod(instrumentId, periodId) {
      return persist('transaction.getByInstrumentAndPeriod', () =>
        findWhere('instrument_id = $1 AND period_id = $2', [instrumentId, periodId]),
      )
    },

    create(input) {
      return persist('transaction.create', async () => {
        const result = await db.execute(
          `INSERT INTO transactions (
             portfolio_id, period_id, instrument_id, date, type,
             quantity, unit_price, gross_amount, net_amount, fees, taxes,
             currency, fx_rate, source_document_id, source_reference
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            input.portfolioId,
            input.periodId,
            input.instrumentId,
            input.date,
            input.type,
            input.quantity,
            input.unitPrice,
            input.grossAmount,
            input.netAmount,
            input.fees,
            input.taxes,
            input.currency,
            input.fxRate,
            input.sourceDocumentId,
            input.sourceReference,
          ],
        )
        const id = insertedId(result, 'transaction.create')
        const created = await findById(id)
        if (!created) {
          throw new RepositoryError('transaction.create: no se pudo leer el registro creado')
        }
        return created
      })
    },
  }
}

export const transactionRepository = createTransactionRepository(getAppDatabaseClient())
