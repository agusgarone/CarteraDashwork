export interface SnapshotRow {
  id: number
  portfolio_id: number
  period_id: number
  date: string
  total_value: string
  currency: string
  source_document_id: number | null
  created_at: string
}

export interface PositionRow {
  id: number
  snapshot_id: number
  instrument_id: number
  quantity: string
  unit_price: string
  market_value: string
  currency: string
}

export interface CashBalanceRow {
  id: number
  snapshot_id: number
  currency: string
  amount: string
  fx_rate: string | null
  value_in_base_currency: string | null
}
