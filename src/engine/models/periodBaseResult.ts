import type { DecimalString } from '../../domain/common'

/**
 * Resultado residual del período.
 * investmentResult es lo que generaron las inversiones después de
 * descontar aportes y sumar retiros. Todavía no se descompone ni se
 * expresa como porcentaje.
 */
export interface PeriodBaseResult {
  openingValue: DecimalString
  closingValue: DecimalString

  contributions: DecimalString
  withdrawals: DecimalString
  netContributions: DecimalString

  investmentResult: DecimalString
}
