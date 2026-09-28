export interface PeriodRow {
  id: number
  portfolio_id: number
  year: number
  month: number
  status: string
  created_at: string
  completed_at: string | null
}
