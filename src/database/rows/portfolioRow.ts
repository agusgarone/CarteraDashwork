/** Fila de `portfolios`. INTEGER llega como number; el mapper lo pasa a string. */
export interface PortfolioRow {
  id: number
  name: string
  broker: string
  base_currency: string
  created_at: string
}
