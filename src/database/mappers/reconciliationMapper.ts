import type { ReconciliationRun } from '../../domain/reconciliation'
import type { ReconciliationRow } from '../rows/reconciliationRow'
import { mapDecimal, mapId, mapReconciliationStatus } from './values'

export function mapReconciliationRow(row: ReconciliationRow): ReconciliationRun {
  return {
    id: mapId(row.id),
    periodId: mapId(row.period_id),
    openingValue: mapDecimal(row.opening_value),
    closingValue: mapDecimal(row.closing_value),
    contributions: mapDecimal(row.contributions),
    withdrawals: mapDecimal(row.withdrawals),
    expectedResult: mapDecimal(row.expected_result),
    explainedResult: mapDecimal(row.explained_result),
    difference: mapDecimal(row.difference),
    status: mapReconciliationStatus(row.status),
    engineVersion: row.engine_version,
    createdAt: row.created_at,
  }
}