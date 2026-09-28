export interface ReconciliationRow {
  id: number
  period_id: number
  opening_value: string
  closing_value: string
  contributions: string
  withdrawals: string
  expected_result: string
  explained_result: string
  difference: string
  status: string
  engine_version: string
  created_at: string
}