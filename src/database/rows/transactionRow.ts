export interface TransactionRow {
  id: number
  portfolio_id: number
  period_id: number
  instrument_id: number | null
  date: string
  type: string
  quantity: string | null
  unit_price: string | null
  gross_amount: string | null
  net_amount: string | null
  fees: string | null
  taxes: string | null
  currency: string
  fx_rate: string | null
  source_document_id: number | null
  source_reference: string | null
  created_at: string
}
