import type { DecimalString } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import type { ParserWarning } from './parsedMonthlyAccount'

/**
 * Estado de un fondo en una fecha.
 * Saldo anterior y total de inversión son fotos, no suscripciones ni rescates.
 * amount es el monto impreso. No se recalcula como cantidad por valor de cuota.
 */
export type ParsedFundStatementRowType =
  | 'PREVIOUS_BALANCE'
  | 'CURRENT_INVESTMENT'
  | 'SUBSCRIPTION'
  | 'REDEMPTION'
  | 'OTHER'

export interface ParsedFundStatementRow {
  type: ParsedFundStatementRowType
  date: string
  unitValue: DecimalString | null
  quantity: DecimalString | null
  amount: DecimalString | null
  sourceReference: string
}

/**
 * Un fondo del resumen cuotapartista.
 * No trae el ticker de la posición consolidada.
 */
export interface ParsedFundStatement {
  categoryName: string
  fundName: string
  shareClass: string | null
  currency: CurrencyCode
  rows: ParsedFundStatementRow[]
}

export interface ParsedMonthlyFundStatement {
  broker: 'BALANZ'
  reportDate: string
  funds: ParsedFundStatement[]
  warnings: ParserWarning[]
}
