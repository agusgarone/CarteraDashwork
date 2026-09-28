import type { DatabaseClient } from '../database/client'
import { insertedId } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { RepositoryError, persist } from '../database/errors'
import { mapPortfolioRow } from '../database/mappers/portfolioMapper'
import type { PortfolioRow } from '../database/rows/portfolioRow'
import type { EntityId } from '../domain/common'
import type { Portfolio } from '../domain/portfolio'

export type CreatePortfolioInput = Omit<Portfolio, 'id' | 'createdAt'>

const COLUMNS = 'id, name, broker, base_currency, created_at'

export interface PortfolioRepository {
  getById(id: EntityId): Promise<Portfolio | null>
  getAll(): Promise<Portfolio[]>
  create(input: CreatePortfolioInput): Promise<Portfolio>
}

export function createPortfolioRepository(db: DatabaseClient): PortfolioRepository {
  async function findById(id: EntityId): Promise<Portfolio | null> {
    const row = await db.selectOne<PortfolioRow>(
      `SELECT ${COLUMNS} FROM portfolios WHERE id = $1`,
      [id],
    )
    return row ? mapPortfolioRow(row) : null
  }

  return {
    getById(id) {
      return persist('portfolio.getById', () => findById(id))
    },

    getAll() {
      return persist('portfolio.getAll', async () => {
        const rows = await db.select<PortfolioRow>(
          `SELECT ${COLUMNS} FROM portfolios ORDER BY id ASC`,
        )
        return rows.map(mapPortfolioRow)
      })
    },

    create(input) {
      return persist('portfolio.create', async () => {
        const result = await db.execute(
          `INSERT INTO portfolios (name, broker, base_currency) VALUES ($1, $2, $3)`,
          [input.name, input.broker, input.baseCurrency],
        )
        const id = insertedId(result, 'portfolio.create')
        const created = await findById(id)
        if (!created) {
          throw new RepositoryError('portfolio.create: no se pudo leer el registro creado')
        }
        return created
      })
    },
  }
}

export const portfolioRepository = createPortfolioRepository(getAppDatabaseClient())
