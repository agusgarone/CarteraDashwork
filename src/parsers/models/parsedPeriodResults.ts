import type { DecimalString } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'

export type PeriodResultsFxKind = 'MEP' | 'CCL' | 'OFFICIAL'

export interface PeriodResultsLotRow {
  sheet: 'resultados_por_lotes_iniciales' | 'resultados_por_lotes_finales'
  rowNumber: number
  lotDate: string
  ticker: string
}

export interface PeriodResultsFxSelection {
  side: 'BUY' | 'SELL' | 'INCOME'
  operationReference: string | null
  currency: CurrencyCode
  kind: Exclude<PeriodResultsFxKind, 'OFFICIAL'>
  rate: DecimalString
  column: string
  date: string
  ticker: string
  movementType: 'Orden' | 'No Realizado' | 'Dividendo' | 'Cupón'
  quantity: DecimalString | null
  rowNumber: number
  sheet: 'resultados_por_realizado'
}

export interface ParsedPeriodResults {
  documentType: 'PERIOD_RESULTS'
  openingDate: string
  closingDate: string
  initialLotCount: number
  realizedCount: number
  finalLotCount: number
  initialLots: PeriodResultsLotRow[]
  finalLots: PeriodResultsLotRow[]
  selections: PeriodResultsFxSelection[]
}
