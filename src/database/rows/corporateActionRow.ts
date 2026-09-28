export interface CorporateActionRow {
  id: number
  portfolio_id: number
  period_id: number
  instrument_id: number
  date: string
  type: string
  quantity_before: string | null
  quantity_change: string | null
  quantity_after: string | null
  ratio: string | null
  description: string | null
  source_document_id: number | null
  created_at: string
}
