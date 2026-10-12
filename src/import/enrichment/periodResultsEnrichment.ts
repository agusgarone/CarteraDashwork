import type { EntityId } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import type { TransactionType } from '../../domain/transaction'
import { operationReferenceFromText } from '../../parsers/balanz/periodResults'
import type { ParsedPeriodResults, PeriodResultsFxKind, PeriodResultsFxSelection } from '../../parsers/models/parsedPeriodResults'
import { ImportPeriodValidationError } from '../importPeriodErrors'

export interface TransactionFxTarget {
  id: EntityId
  type: TransactionType
  date: string
  ticker: string | null
  currency: CurrencyCode
  sourceReference: string | null
}

export interface PlannedTransactionFx {
  transactionId: EntityId
  fxRate: string
  fxKind: PeriodResultsFxKind
  fxDate: string
  sourceSheet: string
  sourceRow: number
  sourceColumn: string
  operationReference: string | null
}

/**
 * El Excel no crea operaciones.
 * Un boleto se cruza con la compra o la venta ya leída del resumen mensual.
 * Un dividendo o un cupón se cruzan por tipo, ticker y fecha.
 */
export function planTransactionFxEnrichments(
  parsed: ParsedPeriodResults,
  transactions: readonly TransactionFxTarget[],
): PlannedTransactionFx[] {
  const planned: PlannedTransactionFx[] = []
  for (const selection of parsed.selections) {
    const matches = transactions.filter((movement) => matchesSelection(movement, selection))
    if (matches.length === 0) continue
    if (matches.length > 1) {
      throw new ImportPeriodValidationError(
        `El tipo de cambio de ${selection.ticker} el ${selection.date} coincide con más de una operación.`,
      )
    }
    const movement = matches[0]
    if (!movement) continue
    const current = planned.find((item) => item.transactionId === movement.id)
    if (current && current.fxRate !== selection.rate) {
      throw new ImportPeriodValidationError(
        `La operación ${movement.id} recibe dos tipos de cambio distintos desde el Excel.`,
      )
    }
    if (current) continue
    planned.push({
      transactionId: movement.id,
      fxRate: selection.rate,
      fxKind: selection.kind,
      fxDate: selection.date,
      sourceSheet: selection.sheet,
      sourceRow: selection.rowNumber,
      sourceColumn: selection.column,
      operationReference: selection.operationReference,
    })
  }
  return planned
}

export function assertPeriodResultsMatch(
  parsed: ParsedPeriodResults,
  bounds: { openingDate: string | null; closingDate: string },
): void {
  if (parsed.closingDate !== bounds.closingDate) {
    throw new ImportPeriodValidationError('El archivo de resultados no corresponde a este período.')
  }
  if (bounds.openingDate && parsed.openingDate !== bounds.openingDate) {
    throw new ImportPeriodValidationError('El archivo de resultados no corresponde a este período.')
  }
}

function matchesSelection(movement: TransactionFxTarget, selection: PeriodResultsFxSelection): boolean {
  if (selection.side === 'INCOME') {
    const type = selection.movementType === 'Dividendo' ? 'DIVIDEND' : 'INTEREST'
    return (
      movement.type === type &&
      movement.date === selection.date &&
      movement.ticker === selection.ticker &&
      movement.currency === selection.currency
    )
  }
  const reference = operationReferenceFromText(movement.sourceReference)
  if (!reference || reference !== selection.operationReference) return false
  return selection.side === 'BUY' ? movement.type === 'BUY' : movement.type === 'SELL'
}
