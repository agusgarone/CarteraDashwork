import type { DatabaseClient } from '../database/client'
import { insertedId } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { RepositoryError, persist } from '../database/errors'
import { mapReconciliationRow } from '../database/mappers/reconciliationMapper'
import type { ReconciliationRow } from '../database/rows/reconciliationRow'
import type { EntityId } from '../domain/common'
import type { ReconciliationRun } from '../domain/reconciliation'

export type CreateReconciliationInput = Omit<ReconciliationRun, 'id' | 'createdAt'>

const COLUMNS = `id, period_id, opening_value, closing_value, contributions, withdrawals,
  expected_result, explained_result, difference, status, engine_version, created_at`

export interface ReconciliationRepository {
  getById(id: EntityId): Promise<ReconciliationRun | null>
  getByPeriod(periodId: EntityId): Promise<ReconciliationRun[]>
  getLatestByPeriod(periodId: EntityId): Promise<ReconciliationRun | null>
  create(input: CreateReconciliationInput): Promise<ReconciliationRun>
}

export function createReconciliationRepository(db: DatabaseClient): ReconciliationRepository {
  async function findById(id: EntityId): Promise<ReconciliationRun | null> {
    const row = await db.selectOne<ReconciliationRow>(
      `SELECT ${COLUMNS} FROM reconciliation_runs WHERE id = $1`,
      [id],
    )
    return row ? mapReconciliationRow(row) : null
  }

  return {
    getById(id) {
      return persist('reconciliation.getById', () => findById(id))
    },

    getByPeriod(periodId) {
      return persist('reconciliation.getByPeriod', async () => {
        const rows = await db.select<ReconciliationRow>(
          `SELECT ${COLUMNS}
           FROM reconciliation_runs
           WHERE period_id = $1
           ORDER BY created_at ASC, id ASC`,
          [periodId],
        )
        return rows.map(mapReconciliationRow)
      })
    },

    getLatestByPeriod(periodId) {
      return persist('reconciliation.getLatestByPeriod', async () => {
        const row = await db.selectOne<ReconciliationRow>(
          `SELECT ${COLUMNS}
           FROM reconciliation_runs
           WHERE period_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
          [periodId],
        )
        return row ? mapReconciliationRow(row) : null
      })
    },

    create(input) {
      return persist('reconciliation.create', async () => {
        const result = await db.execute(
          `INSERT INTO reconciliation_runs (
             period_id, opening_value, closing_value, contributions, withdrawals,
             expected_result, explained_result, difference, status, engine_version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            input.periodId,
            input.openingValue,
            input.closingValue,
            input.contributions,
            input.withdrawals,
            input.expectedResult,
            input.explainedResult,
            input.difference,
            input.status,
            input.engineVersion,
          ],
        )
        const id = insertedId(result, 'reconciliation.create')
        const created = await findById(id)
        if (!created) {
          throw new RepositoryError('reconciliation.create: no se pudo leer el registro creado')
        }
        return created
      })
    },
  }
}

export const reconciliationRepository = createReconciliationRepository(getAppDatabaseClient())
