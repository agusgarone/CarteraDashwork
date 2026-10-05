import Decimal from 'decimal.js'
import type { DecimalString } from '../../domain/common'
import type { Transaction } from '../../domain/transaction'
import { daysBetween } from '../calendarDate'
import { AnalysisError } from '../errors/analysisErrors'
import type { ModifiedDietzFlow, PeriodReturnResult } from '../models/periodReturn'
import { resolveExternalFlowAmount } from './externalFlows'
import { parseDecimal } from '../money'

/**
 * Modified Dietz del período entre dos snapshots.
 *
 * totalPeriodDays = días civiles entre la fecha del snapshot de apertura
 * y la del cierre. No se asume un mes de calendario.
 * remainingDays = días civiles entre la fecha del flujo y el cierre.
 * weight = remainingDays / totalPeriodDays.
 *
 * Un flujo en la fecha de apertura pesa 1: estuvo expuesto todo el período.
 * Un flujo en la fecha de cierre pesa 0: no estuvo expuesto.
 *
 * Solo CONTRIBUTION y WITHDRAWAL son flujos externos. El importe sale de
 * resolveExternalFlowAmount. El aporte suma y el retiro resta.
 * El numerador es el investmentResult ya calculado: esta función no lo rehace.
 *
 * Las cadenas guardan 28 decimales. Eso no es el redondeo de la pantalla.
 */
const SCALE = 28
const DietzDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export interface ModifiedDietzInput {
  investmentResult: DecimalString
  openingValue: DecimalString
  openingDate: string
  closingDate: string
  transactions: readonly Transaction[]
}

export function calculateModifiedDietz(input: ModifiedDietzInput): PeriodReturnResult {
  const totalPeriodDays = daysBetween(input.openingDate, input.closingDate)
  if (totalPeriodDays <= 0) {
    throw new AnalysisError(
      `El cierre ${input.closingDate} no es posterior a la apertura ${input.openingDate}.`,
    )
  }

  const numerator = parseDecimal(input.investmentResult)
  let weightedCapital = new DietzDecimal(input.openingValue)
  const externalFlows: ModifiedDietzFlow[] = []

  for (const transaction of input.transactions) {
    if (transaction.type !== 'CONTRIBUTION' && transaction.type !== 'WITHDRAWAL') continue

    const weightDays = flowWeightDays(transaction, input.openingDate, input.closingDate, totalPeriodDays)
    const magnitude = new DietzDecimal(resolveExternalFlowAmount(transaction))
    const amount = transaction.type === 'CONTRIBUTION' ? magnitude : magnitude.neg()
    const weight = new DietzDecimal(weightDays).div(totalPeriodDays)
    const weightedAmount = amount.times(weight)
    weightedCapital = weightedCapital.plus(weightedAmount)
    externalFlows.push({
      transactionId: transaction.id,
      date: transaction.date,
      amount: scale(amount),
      weight: scale(weight),
      weightedAmount: scale(weightedAmount),
    })
  }

  const weightedText = scale(weightedCapital)
  if (weightedCapital.lte(0)) {
    return {
      status: 'INVALID_WEIGHTED_CAPITAL',
      method: 'MODIFIED_DIETZ',
      numerator: input.investmentResult,
      weightedCapital: weightedText,
      returnDecimal: null,
      reason: 'El capital ponderado no es positivo. No hay un rendimiento definido.',
      externalFlows,
    }
  }

  return {
    status: 'CALCULATED',
    method: 'MODIFIED_DIETZ',
    numerator: input.investmentResult,
    weightedCapital: weightedText,
    returnDecimal: scale(new DietzDecimal(numerator.toString()).div(weightedCapital)),
    externalFlows,
  }
}

function flowWeightDays(
  transaction: Transaction,
  openingDate: string,
  closingDate: string,
  totalPeriodDays: number,
): number {
  const fromOpening = daysBetween(openingDate, transaction.date)
  const remaining = daysBetween(transaction.date, closingDate)
  if (fromOpening < 0 || remaining < 0) {
    throw new AnalysisError(
      `El flujo externo ${transaction.id} del ${transaction.date} está fuera del período ${openingDate} – ${closingDate}.`,
    )
  }
  if (fromOpening + remaining !== totalPeriodDays) {
    throw new AnalysisError(
      `La fecha ${transaction.date} no cae entre ${openingDate} y ${closingDate}.`,
    )
  }
  return remaining
}

function scale(value: Decimal): DecimalString {
  return value.toFixed(SCALE)
}
