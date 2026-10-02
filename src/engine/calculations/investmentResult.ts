import type { DecimalString } from '../../domain/common'
import { formatMonetary, parseDecimal } from '../money'

export interface InvestmentResultInput {
  openingValue: DecimalString
  closingValue: DecimalString
  contributions: DecimalString
  withdrawals: DecimalString
}

/**
 * Resultado residual entre dos valores de cartera.
 *
 * investmentResult = closing − opening − contributions + withdrawals
 *
 * No es un porcentaje. Aportes y retiros durante el período hacen que
 * dividir por el valor de apertura no sea un rendimiento.
 */
export function calculateExpectedInvestmentResult(input: InvestmentResultInput): DecimalString {
  const closingValue = parseDecimal(input.closingValue)
  const openingValue = parseDecimal(input.openingValue)
  const contributions = parseDecimal(input.contributions)
  const withdrawals = parseDecimal(input.withdrawals)

  const investmentResult = closingValue
    .minus(openingValue)
    .minus(contributions)
    .plus(withdrawals)

  return formatMonetary(investmentResult)
}

/** netContributions = contributions − withdrawals */
export function calculateNetContributions(
  contributions: DecimalString,
  withdrawals: DecimalString,
): DecimalString {
  const netContributions = parseDecimal(contributions).minus(parseDecimal(withdrawals))
  return formatMonetary(netContributions)
}
