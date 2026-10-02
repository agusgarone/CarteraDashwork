import type { DatabaseClient, TransactionStatement } from '../database/client'
import { insertedId } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { RepositoryError, persist } from '../database/errors'
import {
  mapCashBalanceRow,
  mapPositionRow,
  mapSnapshotRow,
} from '../database/mappers/snapshotMapper'
import type { CashBalanceRow, PositionRow, SnapshotRow } from '../database/rows/snapshotRow'
import type { EntityId } from '../domain/common'
import type {
  CashBalance,
  PortfolioSnapshot,
  PortfolioSnapshotAggregate,
  Position,
} from '../domain/snapshot'

export type CreateSnapshotInput = Omit<PortfolioSnapshot, 'id' | 'createdAt'>
export type CreatePositionInput = Omit<Position, 'id'>
export type CreateCashBalanceInput = Omit<CashBalance, 'id'>

export interface CreateSnapshotAggregateInput {
  snapshot: CreateSnapshotInput
  positions: Array<Omit<CreatePositionInput, 'snapshotId'>>
  cashBalances: Array<Omit<CreateCashBalanceInput, 'snapshotId'>>
}

const SNAPSHOT_COLUMNS =
  'id, portfolio_id, period_id, date, total_value, currency, source_document_id, created_at'
const POSITION_COLUMNS =
  'id, snapshot_id, instrument_id, quantity, unit_price, market_value, currency'
const CASH_COLUMNS = 'id, snapshot_id, currency, amount, fx_rate, value_in_base_currency'

export interface SnapshotRepository {
  getById(id: EntityId): Promise<PortfolioSnapshot | null>
  getByPeriod(periodId: EntityId): Promise<PortfolioSnapshot[]>
  getByDate(portfolioId: EntityId, date: string): Promise<PortfolioSnapshot | null>
  getLatest(portfolioId: EntityId): Promise<PortfolioSnapshot | null>
  /**
   * Último snapshot con fecha estrictamente anterior a `date`.
   * La apertura de un período no tiene que compartir su periodId.
   */
  getLatestBefore(portfolioId: EntityId, date: string): Promise<PortfolioSnapshot | null>
  /** Último snapshot del período, por fecha. Puede haber más de uno. */
  getLatestByPeriod(periodId: EntityId): Promise<PortfolioSnapshot | null>
  createSnapshot(input: CreateSnapshotInput): Promise<PortfolioSnapshot>
  createPosition(input: CreatePositionInput): Promise<Position>
  createCashBalance(input: CreateCashBalanceInput): Promise<CashBalance>
  getPositions(snapshotId: EntityId): Promise<Position[]>
  getCashBalances(snapshotId: EntityId): Promise<CashBalance[]>
  getAggregate(snapshotId: EntityId): Promise<PortfolioSnapshotAggregate | null>
  /**
   * Inserta snapshot, caja y posiciones en una sola transacción.
   * Si una sentencia falla, no queda ninguna de esas filas.
   */
  createAggregate(input: CreateSnapshotAggregateInput): Promise<PortfolioSnapshotAggregate>
}

export function createSnapshotRepository(db: DatabaseClient): SnapshotRepository {
  async function findById(id: EntityId): Promise<PortfolioSnapshot | null> {
    const row = await db.selectOne<SnapshotRow>(
      `SELECT ${SNAPSHOT_COLUMNS} FROM snapshots WHERE id = $1`,
      [id],
    )
    return row ? mapSnapshotRow(row) : null
  }

  async function findPositions(snapshotId: EntityId): Promise<Position[]> {
    const rows = await db.select<PositionRow>(
      `SELECT ${POSITION_COLUMNS}
       FROM positions
       WHERE snapshot_id = $1
       ORDER BY id ASC`,
      [snapshotId],
    )
    return rows.map(mapPositionRow)
  }

  async function findCashBalances(snapshotId: EntityId): Promise<CashBalance[]> {
    const rows = await db.select<CashBalanceRow>(
      `SELECT ${CASH_COLUMNS}
       FROM cash_balances
       WHERE snapshot_id = $1
       ORDER BY id ASC`,
      [snapshotId],
    )
    return rows.map(mapCashBalanceRow)
  }

  async function insertSnapshot(input: CreateSnapshotInput): Promise<PortfolioSnapshot> {
    const result = await db.execute(
      `INSERT INTO snapshots (
         portfolio_id, period_id, date, total_value, currency, source_document_id
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.portfolioId,
        input.periodId,
        input.date,
        input.totalValue,
        input.currency,
        input.sourceDocumentId,
      ],
    )
    const id = insertedId(result, 'snapshot.createSnapshot')
    const created = await findById(id)
    if (!created) {
      throw new RepositoryError('snapshot.createSnapshot: no se pudo leer el registro creado')
    }
    return created
  }

  async function insertPosition(input: CreatePositionInput): Promise<Position> {
    const result = await db.execute(
      `INSERT INTO positions (
         snapshot_id, instrument_id, quantity, unit_price, market_value, currency
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.snapshotId,
        input.instrumentId,
        input.quantity,
        input.unitPrice,
        input.marketValue,
        input.currency,
      ],
    )
    const id = insertedId(result, 'snapshot.createPosition')
    const row = await db.selectOne<PositionRow>(
      `SELECT ${POSITION_COLUMNS} FROM positions WHERE id = $1`,
      [id],
    )
    if (!row) {
      throw new RepositoryError('snapshot.createPosition: no se pudo leer el registro creado')
    }
    return mapPositionRow(row)
  }

  async function insertCashBalance(input: CreateCashBalanceInput): Promise<CashBalance> {
    const result = await db.execute(
      `INSERT INTO cash_balances (
         snapshot_id, currency, amount, fx_rate, value_in_base_currency
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        input.snapshotId,
        input.currency,
        input.amount,
        input.fxRate,
        input.valueInBaseCurrency,
      ],
    )
    const id = insertedId(result, 'snapshot.createCashBalance')
    const row = await db.selectOne<CashBalanceRow>(
      `SELECT ${CASH_COLUMNS} FROM cash_balances WHERE id = $1`,
      [id],
    )
    if (!row) {
      throw new RepositoryError('snapshot.createCashBalance: no se pudo leer el registro creado')
    }
    return mapCashBalanceRow(row)
  }

  return {
    getById(id) {
      return persist('snapshot.getById', () => findById(id))
    },

    getByPeriod(periodId) {
      return persist('snapshot.getByPeriod', async () => {
        const rows = await db.select<SnapshotRow>(
          `SELECT ${SNAPSHOT_COLUMNS}
           FROM snapshots
           WHERE period_id = $1
           ORDER BY date ASC, id ASC`,
          [periodId],
        )
        return rows.map(mapSnapshotRow)
      })
    },

    getByDate(portfolioId, date) {
      return persist('snapshot.getByDate', async () => {
        const row = await db.selectOne<SnapshotRow>(
          `SELECT ${SNAPSHOT_COLUMNS}
           FROM snapshots
           WHERE portfolio_id = $1 AND date = $2`,
          [portfolioId, date],
        )
        return row ? mapSnapshotRow(row) : null
      })
    },

    getLatest(portfolioId) {
      return persist('snapshot.getLatest', async () => {
        const row = await db.selectOne<SnapshotRow>(
          `SELECT ${SNAPSHOT_COLUMNS}
           FROM snapshots
           WHERE portfolio_id = $1
           ORDER BY date DESC, id DESC
           LIMIT 1`,
          [portfolioId],
        )
        return row ? mapSnapshotRow(row) : null
      })
    },

    getLatestBefore(portfolioId, date) {
      return persist('snapshot.getLatestBefore', async () => {
        const row = await db.selectOne<SnapshotRow>(
          `SELECT ${SNAPSHOT_COLUMNS}
           FROM snapshots
           WHERE portfolio_id = $1 AND date < $2
           ORDER BY date DESC, id DESC
           LIMIT 1`,
          [portfolioId, date],
        )
        return row ? mapSnapshotRow(row) : null
      })
    },

    getLatestByPeriod(periodId) {
      return persist('snapshot.getLatestByPeriod', async () => {
        const row = await db.selectOne<SnapshotRow>(
          `SELECT ${SNAPSHOT_COLUMNS}
           FROM snapshots
           WHERE period_id = $1
           ORDER BY date DESC, id DESC
           LIMIT 1`,
          [periodId],
        )
        return row ? mapSnapshotRow(row) : null
      })
    },

    createSnapshot(input) {
      return persist('snapshot.createSnapshot', () => insertSnapshot(input))
    },

    createPosition(input) {
      return persist('snapshot.createPosition', () => insertPosition(input))
    },

    createCashBalance(input) {
      return persist('snapshot.createCashBalance', () => insertCashBalance(input))
    },

    getPositions(snapshotId) {
      return persist('snapshot.getPositions', () => findPositions(snapshotId))
    },

    getCashBalances(snapshotId) {
      return persist('snapshot.getCashBalances', () => findCashBalances(snapshotId))
    },

    getAggregate(snapshotId) {
      return persist('snapshot.getAggregate', async () => {
        const snapshot = await findById(snapshotId)
        if (!snapshot) return null
        return {
          snapshot,
          positions: await findPositions(snapshotId),
          cashBalances: await findCashBalances(snapshotId),
        }
      })
    },

    createAggregate(input) {
      return persist('snapshot.createAggregate', async () => {
        const statements: TransactionStatement[] = [
          {
            sql: `INSERT INTO snapshots (
                    portfolio_id, period_id, date, total_value, currency, source_document_id
                  ) VALUES ($1, $2, $3, $4, $5, $6)`,
            params: [
              input.snapshot.portfolioId,
              input.snapshot.periodId,
              input.snapshot.date,
              input.snapshot.totalValue,
              input.snapshot.currency,
              input.snapshot.sourceDocumentId,
            ],
          },
        ]

        for (const cashBalance of input.cashBalances) {
          statements.push({
            sql: `INSERT INTO cash_balances (
                    snapshot_id, currency, amount, fx_rate, value_in_base_currency
                  ) VALUES ($1, $2, $3, $4, $5)`,
            params: [
              { lastInsertIdOf: 0 },
              cashBalance.currency,
              cashBalance.amount,
              cashBalance.fxRate,
              cashBalance.valueInBaseCurrency,
            ],
          })
        }

        for (const position of input.positions) {
          statements.push({
            sql: `INSERT INTO positions (
                    snapshot_id, instrument_id, quantity, unit_price, market_value, currency
                  ) VALUES ($1, $2, $3, $4, $5, $6)`,
            params: [
              { lastInsertIdOf: 0 },
              position.instrumentId,
              position.quantity,
              position.unitPrice,
              position.marketValue,
              position.currency,
            ],
          })
        }

        const { lastInsertIds } = await db.transaction(statements)
        const snapshotId = insertedId(
          { rowsAffected: 1, lastInsertId: lastInsertIds[0] ?? 0 },
          'snapshot.createAggregate',
        )
        const snapshot = await findById(snapshotId)
        if (!snapshot) {
          throw new RepositoryError(
            'snapshot.createAggregate: no se pudo leer el registro creado',
          )
        }
        return {
          snapshot,
          positions: await findPositions(snapshotId),
          cashBalances: await findCashBalances(snapshotId),
        }
      })
    },
  }
}

export const snapshotRepository = createSnapshotRepository(getAppDatabaseClient())
