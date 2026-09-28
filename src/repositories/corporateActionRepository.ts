import type { DatabaseClient } from '../database/client'
import { insertedId } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { RepositoryError, persist } from '../database/errors'
import { mapCorporateActionRow } from '../database/mappers/corporateActionMapper'
import type { CorporateActionRow } from '../database/rows/corporateActionRow'
import type { EntityId } from '../domain/common'
import type { CorporateAction } from '../domain/corporateAction'

export type CreateCorporateActionInput = Omit<CorporateAction, 'id' | 'createdAt'>

const COLUMNS = `id, portfolio_id, period_id, instrument_id, date, type,
  quantity_before, quantity_change, quantity_after, ratio, description,
  source_document_id, created_at`

export interface CorporateActionRepository {
  getById(id: EntityId): Promise<CorporateAction | null>
  getByPeriod(periodId: EntityId): Promise<CorporateAction[]>
  getByInstrument(instrumentId: EntityId): Promise<CorporateAction[]>
  create(input: CreateCorporateActionInput): Promise<CorporateAction>
}

export function createCorporateActionRepository(db: DatabaseClient): CorporateActionRepository {
  async function findById(id: EntityId): Promise<CorporateAction | null> {
    const row = await db.selectOne<CorporateActionRow>(
      `SELECT ${COLUMNS} FROM corporate_actions WHERE id = $1`,
      [id],
    )
    return row ? mapCorporateActionRow(row) : null
  }

  async function findWhere(where: string, params: Array<string | number | null>): Promise<CorporateAction[]> {
    const rows = await db.select<CorporateActionRow>(
      `SELECT ${COLUMNS}
       FROM corporate_actions
       WHERE ${where}
       ORDER BY date ASC, id ASC`,
      params,
    )
    return rows.map(mapCorporateActionRow)
  }

  return {
    getById(id) {
      return persist('corporateAction.getById', () => findById(id))
    },

    getByPeriod(periodId) {
      return persist('corporateAction.getByPeriod', () => findWhere('period_id = $1', [periodId]))
    },

    getByInstrument(instrumentId) {
      return persist('corporateAction.getByInstrument', () =>
        findWhere('instrument_id = $1', [instrumentId]),
      )
    },

    create(input) {
      return persist('corporateAction.create', async () => {
        const result = await db.execute(
          `INSERT INTO corporate_actions (
             portfolio_id, period_id, instrument_id, date, type,
             quantity_before, quantity_change, quantity_after, ratio,
             description, source_document_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            input.portfolioId,
            input.periodId,
            input.instrumentId,
            input.date,
            input.type,
            input.quantityBefore,
            input.quantityChange,
            input.quantityAfter,
            input.ratio,
            input.description,
            input.sourceDocumentId,
          ],
        )
        const id = insertedId(result, 'corporateAction.create')
        const created = await findById(id)
        if (!created) {
          throw new RepositoryError('corporateAction.create: no se pudo leer el registro creado')
        }
        return created
      })
    },
  }
}

export const corporateActionRepository = createCorporateActionRepository(getAppDatabaseClient())
