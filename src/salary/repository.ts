import type { DatabaseClient } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { validatePlan, type SalaryPlan, type SavedSalaryMonth } from './model'

export function createSalaryRepository(database: DatabaseClient) {
  return {
    async list(): Promise<SavedSalaryMonth[]> {
      const rows = await database.select<{
        month: string
        document: string
        revision: number
      }>('SELECT month, document, revision FROM salary_months ORDER BY month')
      return rows.map((row) => {
        const plan: unknown = JSON.parse(row.document)
        validatePlan(plan)
        if (plan.month !== row.month)
          throw new Error('El mes guardado no coincide con su presupuesto.')
        return { plan, revision: row.revision }
      })
    },
    async save(
      plan: SalaryPlan,
      expectedRevision: number | null,
    ): Promise<SavedSalaryMonth> {
      validatePlan(plan)
      const document = JSON.stringify(plan)
      if (document.length > 1000000)
        throw new Error('El presupuesto supera el tamaño permitido.')
      let result
      if (expectedRevision === null) {
        result = await database.execute(
          'INSERT INTO salary_months (month, document, revision) VALUES ($1, $2, 1) ON CONFLICT(month) DO NOTHING',
          [plan.month, document],
        )
      } else {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
          throw new Error('La revisión del presupuesto no es válida.')
        result = await database.execute(
          'UPDATE salary_months SET document = $1, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE month = $2 AND revision = $3',
          [document, plan.month, expectedRevision],
        )
      }
      if (result.rowsAffected !== 1)
        throw new Error(
          'Este mes cambió en otra sesión. Volvé a cargarlo antes de guardar.',
        )
      return {
        plan: structuredClone(plan),
        revision: expectedRevision === null ? 1 : expectedRevision + 1,
      }
    },
  }
}
export const salaryRepository = createSalaryRepository(getAppDatabaseClient())
