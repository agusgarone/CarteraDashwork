import type { DecimalString } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import type { Transaction } from '../../domain/transaction'
import { AnalysisError, MissingTransactionAmountError } from '../errors/analysisErrors'
import { calculateNetContributions } from './investmentResult'
import { formatMonetary, parseDecimal, zeroDecimal } from '../money'

export interface ExternalFlows {
  contributions: DecimalString
  withdrawals: DecimalString
  netContributions: DecimalString
}

/**
 * Suma aportes y retiros externos.
 *
 * Solo CONTRIBUTION y WITHDRAWAL entran. BUY no es aporte y SELL no es retiro.
 * El importe es el efectivo que entró o salió: netAmount, o grossAmount si
 * el neto no está. Una comisión queda fuera de ese flujo para poder
 * atribuirla después como costo.
 */
export function aggregateExternalFlows(transactions: readonly Transaction[]): ExternalFlows {
  let contributions = zeroDecimal()
  let withdrawals = zeroDecimal()
  let currency: CurrencyCode | null = null

  for (const transaction of transactions) {
    if (transaction.type !== 'CONTRIBUTION' && transaction.type !== 'WITHDRAWAL') {
      continue
    }

    if (currency === null) {
      currency = transaction.currency
    } else if (currency !== transaction.currency) {
      throw new AnalysisError(
        'Los aportes y retiros del período no están en una sola moneda.',
      )
    }

    const amount = parseDecimal(resolveExternalFlowAmount(transaction))
    if (transaction.type === 'CONTRIBUTION') {
      contributions = contributions.plus(amount)
    } else {
      withdrawals = withdrawals.plus(amount)
    }
  }

  const contributionText = formatMonetary(contributions)
  const withdrawalText = formatMonetary(withdrawals)

  return {
    contributions: contributionText,
    withdrawals: withdrawalText,
    netContributions: calculateNetContributions(contributionText, withdrawalText),
  }
}

/**
 * Efectivo que entró o salió de la cartera en un aporte o un retiro.
 * Prioriza netAmount. Si ambos importes faltan, falla: no devuelve cero.
 */
export function resolveExternalFlowAmount(transaction: Transaction): DecimalString {
  if (transaction.type !== 'CONTRIBUTION' && transaction.type !== 'WITHDRAWAL') {
    throw new AnalysisError(
      `El movimiento ${transaction.id} de tipo ${transaction.type} no es un flujo externo.`,
    )
  }

  const amount = transaction.netAmount ?? transaction.grossAmount
  if (amount === null) {
    throw new MissingTransactionAmountError(transaction.id, transaction.type)
  }
  return amount
}
