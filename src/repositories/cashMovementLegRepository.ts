import type { DatabaseClient } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { persist } from '../database/errors'
import type { EntityId } from '../domain/common'
import type { CurrencyCode } from '../domain/currency'
import type { CashLegRole, CashMovementLeg } from '../engine/calculations/cashLedger'

interface CashMovementLegRow {
  operation_reference: string | null
  operation_type: string
  currency: CurrencyCode
  amount: string
  leg_date: string
  role: CashLegRole
  commission: string | null
  vat: string | null
  market_fees: string | null
  tax_component: string | null
}

export interface CashMovementLegRepository {
  getByPeriod(periodId: EntityId): Promise<CashMovementLeg[]>
  saveIfMissing(periodId: EntityId, legs: readonly CashMovementLeg[]): Promise<void>
  fillMissingCosts(periodId: EntityId, legs: readonly CashMovementLeg[]): Promise<void>
}

export function createCashMovementLegRepository(db: DatabaseClient): CashMovementLegRepository {
  return {
    getByPeriod(periodId) {
      return persist('cashMovementLeg.getByPeriod', async () => {
        const rows = await db.select<CashMovementLegRow>(
          `SELECT operation_reference, operation_type, currency, amount, leg_date, role,
                  commission, vat, market_fees, tax_component
           FROM cash_movement_legs
           WHERE period_id = $1
           ORDER BY leg_date ASC, id ASC`,
          [periodId],
        )
        return rows.map((row) => ({
          operationId: row.operation_reference,
          operationType: row.operation_type,
          currency: row.currency,
          amount: row.amount,
          date: row.leg_date,
          role: row.role,
          commission: row.commission,
          vat: row.vat,
          marketFees: row.market_fees,
          taxComponent: row.tax_component,
        }))
      })
    },

    saveIfMissing(periodId, legs) {
      return persist('cashMovementLeg.saveIfMissing', async () => {
        const existing = await db.selectOne<{ total: number }>(
          'SELECT COUNT(*) AS total FROM cash_movement_legs WHERE period_id = $1',
          [periodId],
        )
        if ((existing?.total ?? 0) > 0 || legs.length === 0) return
        await db.transaction(
          legs.map((leg) => ({
            sql: `INSERT INTO cash_movement_legs (
                    period_id, operation_reference, operation_type, currency, amount, leg_date, role,
                    commission, vat, market_fees, tax_component
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            params: [
              periodId,
              leg.operationId,
              leg.operationType,
              leg.currency,
              leg.amount,
              leg.date,
              leg.role,
              leg.commission ?? null,
              leg.vat ?? null,
              leg.marketFees ?? null,
              leg.taxComponent ?? null,
            ],
          })),
        )
      })
    },

    fillMissingCosts(periodId, legs) {
      return persist('cashMovementLeg.fillMissingCosts', async () => {
        const statements = legs
          .filter((leg) => leg.role === 'TRADE_SETTLEMENT')
          .map((leg) => ({
            sql: `UPDATE cash_movement_legs
                  SET commission = $1, vat = $2, market_fees = $3, tax_component = $4
                  WHERE period_id = $5
                    AND operation_reference = $6
                    AND currency = $7
                    AND role = 'TRADE_SETTLEMENT'
                    AND commission IS NULL
                    AND vat IS NULL
                    AND market_fees IS NULL
                    AND tax_component IS NULL`,
            params: [
              leg.commission ?? '0.00',
              leg.vat ?? '0.00',
              leg.marketFees ?? '0.00',
              leg.taxComponent ?? '0.00',
              periodId,
              leg.operationId,
              leg.currency,
            ],
          }))
        if (statements.length === 0) return
        await db.transaction(statements)
      })
    },
  }
}

export const cashMovementLegRepository = createCashMovementLegRepository(getAppDatabaseClient())
