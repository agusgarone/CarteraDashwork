import type { DatabaseClient } from '../database/client'
import { insertedId } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { RepositoryError, persist } from '../database/errors'
import { mapPeriodRow } from '../database/mappers/periodMapper'
import type { PeriodRow } from '../database/rows/periodRow'
import type { EntityId } from '../domain/common'
import type { PeriodStatus, PortfolioPeriod } from '../domain/period'

export interface CreatePortfolioPeriodInput {
  portfolioId: EntityId
  year: number
  month: number
  status?: PeriodStatus
}

export interface UpdatePeriodStatusInput {
  status: PeriodStatus
  completedAt?: string | null
}

const COLUMNS = 'id, portfolio_id, year, month, status, created_at, completed_at'

export interface PeriodRepository {
  getById(id: EntityId): Promise<PortfolioPeriod | null>
  getByPortfolio(portfolioId: EntityId): Promise<PortfolioPeriod[]>
  getByYearMonth(
    portfolioId: EntityId,
    year: number,
    month: number,
  ): Promise<PortfolioPeriod | null>
  create(input: CreatePortfolioPeriodInput): Promise<PortfolioPeriod>
  updateStatus(id: EntityId, input: UpdatePeriodStatusInput): Promise<PortfolioPeriod>
}

export function createPeriodRepository(db: DatabaseClient): PeriodRepository {
  async function findById(id: EntityId): Promise<PortfolioPeriod | null> {
    const row = await db.selectOne<PeriodRow>(
      `SELECT ${COLUMNS} FROM periods WHERE id = $1`,
      [id],
    )
    return row ? mapPeriodRow(row) : null
  }

  return {
    getById(id) {
      return persist('period.getById', () => findById(id))
    },

    getByPortfolio(portfolioId) {
      return persist('period.getByPortfolio', async () => {
        const rows = await db.select<PeriodRow>(
          `SELECT ${COLUMNS}
           FROM periods
           WHERE portfolio_id = $1
           ORDER BY year ASC, month ASC, id ASC`,
          [portfolioId],
        )
        return rows.map(mapPeriodRow)
      })
    },

    getByYearMonth(portfolioId, year, month) {
      return persist('period.getByYearMonth', async () => {
        const row = await db.selectOne<PeriodRow>(
          `SELECT ${COLUMNS}
           FROM periods
           WHERE portfolio_id = $1 AND year = $2 AND month = $3`,
          [portfolioId, year, month],
        )
        return row ? mapPeriodRow(row) : null
      })
    },

    create(input) {
      return persist('period.create', async () => {
        const result = await db.execute(
          `INSERT INTO periods (portfolio_id, year, month, status)
           VALUES ($1, $2, $3, $4)`,
          [input.portfolioId, input.year, input.month, input.status ?? 'PENDING'],
        )
        const id = insertedId(result, 'period.create')
        const created = await findById(id)
        if (!created) {
          throw new RepositoryError('period.create: no se pudo leer el registro creado')
        }
        return created
      })
    },

    updateStatus(id, input) {
      return persist('period.updateStatus', async () => {
        const current = await findById(id)
        if (!current) {
          throw new RepositoryError(`period.updateStatus: el período ${id} no existe`)
        }
        const completedAt =
          input.completedAt === undefined ? current.completedAt : input.completedAt
        const result = await db.execute(
          `UPDATE periods SET status = $1, completed_at = $2 WHERE id = $3`,
          [input.status, completedAt, id],
        )
        if (result.rowsAffected === 0) {
          throw new RepositoryError(`period.updateStatus: el período ${id} no existe`)
        }
        const updated = await findById(id)
        if (!updated) {
          throw new RepositoryError(`period.updateStatus: el período ${id} no existe`)
        }
        return updated
      })
    },
  }
}

export const periodRepository = createPeriodRepository(getAppDatabaseClient())
