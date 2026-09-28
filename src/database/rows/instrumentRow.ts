export interface InstrumentRow {
  id: number
  ticker: string
  name: string | null
  category: string
  currency: string
  broker_identifier: string | null
  created_at: string
}
