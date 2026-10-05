import type { DecimalString, EntityId } from '../../domain/common'
import type { CorporateAction } from '../../domain/corporateAction'
import type { CurrencyCode } from '../../domain/currency'
import type { Position } from '../../domain/snapshot'
import type { Transaction, TransactionType } from '../../domain/transaction'
import { AnalysisError } from '../errors/analysisErrors'
import { formatMonetary, parseDecimal, zeroDecimal } from '../money'
import type {
  PositionValuationResult,
  PositionValuationStatus,
} from '../models/positionValuation'

const BLOCKING_TRANSACTION_TYPES = [
  'BUY',
  'SELL',
  'FUND_SUBSCRIPTION',
  'FUND_REDEMPTION',
] as const satisfies readonly TransactionType[]

export interface PositionValuationInput {
  openingPositions: readonly Position[]
  closingPositions: readonly Position[]
  transactions: readonly Transaction[]
  corporateActions: readonly CorporateAction[]
  currency: CurrencyCode
}

export interface StablePositionInput {
  opening: Position
  closing: Position
  transactions: readonly Transaction[]
  corporateActions: readonly CorporateAction[]
}

/**
 * Compara la valuación reportada de una posición que está en ambos snapshots.
 * Usa marketValue. No recalcula quantity * unitPrice.
 * La caja no entra en esta función.
 */
export function calculateStablePositionValuation(input: StablePositionInput): PositionValuationResult {
  if (input.opening.instrumentId !== input.closing.instrumentId) {
    throw new AnalysisError('Las posiciones comparadas no son del mismo instrumento.')
  }

  const instrumentId = input.opening.instrumentId
  const base = {
    instrumentId,
    openingQuantity: input.opening.quantity,
    closingQuantity: input.closing.quantity,
    openingValue: formatMonetary(parseDecimal(input.opening.marketValue)),
    closingValue: formatMonetary(parseDecimal(input.closing.marketValue)),
  }

  if (hasBlockingTransaction(input.transactions, instrumentId)) {
    return unexplained(
      base,
      'HAS_PERIOD_TRANSACTION',
      'Hay una compra, venta o movimiento de fondo en el período.',
    )
  }

  const corporateActions = actionsFor(input.corporateActions, instrumentId)
  const corporateAction = classifyStockDividends(
    corporateActions,
    input.opening.quantity,
    input.closing.quantity,
  )
  if (corporateAction === 'pending') {
    return unexplained(
      base,
      'HAS_CORPORATE_ACTION',
      'Hay una acción corporativa que esta versión no explica.',
    )
  }
  if (corporateAction === 'mismatch') {
    return unexplained(
      base,
      'CORPORATE_ACTION_MISMATCH',
      'La acción corporativa no cierra la cantidad de la posición.',
    )
  }
  if (corporateAction === 'explained') {
    return {
      ...base,
      valuationChange: marketValueChange(input.opening, input.closing),
      status: 'CORPORATE_ACTION_EXPLAINED',
      reason: null,
    }
  }

  const sameQuantity = parseDecimal(input.opening.quantity).eq(input.closing.quantity)
  if (!sameQuantity) {
    return unexplained(
      base,
      'QUANTITY_CHANGED',
      'La cantidad cambió y no hay un evento que lo explique.',
    )
  }

  return {
    ...base,
    valuationChange: marketValueChange(input.opening, input.closing),
    status: 'EXPLAINED',
    reason: null,
  }
}

/**
 * Une apertura y cierre por instrumentId.
 * El orden de los arrays no importa.
 * Los saldos de caja no se analizan acá.
 */
export function analyzePositionValuations(input: PositionValuationInput): PositionValuationResult[] {
  const opening = indexByInstrument(input.openingPositions, input.currency)
  const closing = indexByInstrument(input.closingPositions, input.currency)
  const instrumentIds = [...new Set([...opening.keys(), ...closing.keys()])].sort()

  return instrumentIds.map((instrumentId) => {
    const openingPosition = opening.get(instrumentId) ?? null
    const closingPosition = closing.get(instrumentId) ?? null

    if (openingPosition && closingPosition) {
      return calculateStablePositionValuation({
        opening: openingPosition,
        closing: closingPosition,
        transactions: input.transactions,
        corporateActions: input.corporateActions,
      })
    }

    if (!openingPosition && closingPosition) {
      return {
        instrumentId,
        openingQuantity: null,
        closingQuantity: closingPosition.quantity,
        openingValue: null,
        closingValue: formatMonetary(parseDecimal(closingPosition.marketValue)),
        valuationChange: null,
        status: 'MISSING_OPENING_POSITION',
        reason: 'La posición no existe en la apertura. No se asume valor cero.',
      }
    }

    return {
      instrumentId,
      openingQuantity: openingPosition?.quantity ?? null,
      closingQuantity: null,
      openingValue: openingPosition
        ? formatMonetary(parseDecimal(openingPosition.marketValue))
        : null,
      closingValue: null,
      valuationChange: null,
      status: 'MISSING_CLOSING_POSITION',
      reason: 'La posición no existe en el cierre. No se asume una venta total.',
    }
  })
}

/** Suma posiciones estables y dividendos en acciones cuya cantidad cierra. */
export function calculateTotalValuationChange(
  results: readonly PositionValuationResult[],
): DecimalString {
  let total = zeroDecimal()
  for (const result of results) {
    if (!isIncludedInValuation(result.status) || result.valuationChange === null) continue
    total = total.plus(parseDecimal(result.valuationChange))
  }
  return formatMonetary(total)
}

function indexByInstrument(
  positions: readonly Position[],
  currency: CurrencyCode,
): Map<EntityId, Position> {
  const indexed = new Map<EntityId, Position>()
  for (const position of positions) {
    if (position.currency !== currency) {
      throw new AnalysisError(
        `La posición ${position.instrumentId} está en ${position.currency} y el cierre en ${currency}. No hay conversión de moneda.`,
      )
    }
    if (indexed.has(position.instrumentId)) {
      throw new AnalysisError(`El instrumento ${position.instrumentId} está repetido en el snapshot.`)
    }
    indexed.set(position.instrumentId, position)
  }
  return indexed
}

function marketValueChange(opening: Position, closing: Position): DecimalString {
  return formatMonetary(parseDecimal(closing.marketValue).minus(opening.marketValue))
}

/**
 * Un STOCK_DIVIDEND explica el cambio de cantidad, no un ingreso de caja.
 * El efecto económico es solo la diferencia de marketValue.
 * quantityChange * precio no se suma aparte.
 */
function classifyStockDividends(
  actions: readonly CorporateAction[],
  openingQuantity: string,
  closingQuantity: string,
): 'none' | 'pending' | 'explained' | 'mismatch' {
  if (actions.length === 0) return 'none'
  if (actions.some((action) => action.type !== 'STOCK_DIVIDEND')) return 'pending'

  const opening = parseDecimal(openingQuantity)
  const closing = parseDecimal(closingQuantity)
  let quantityChange = zeroDecimal()

  for (const action of actions) {
    if (action.quantityChange === null) return 'mismatch'
    if (action.quantityBefore !== null && !parseDecimal(action.quantityBefore).eq(opening)) {
      return 'mismatch'
    }
    if (action.quantityAfter !== null && !parseDecimal(action.quantityAfter).eq(closing)) {
      return 'mismatch'
    }
    quantityChange = quantityChange.plus(parseDecimal(action.quantityChange))
  }

  if (!opening.plus(quantityChange).eq(closing)) return 'mismatch'
  return 'explained'
}

function actionsFor(
  corporateActions: readonly CorporateAction[],
  instrumentId: EntityId,
): CorporateAction[] {
  return corporateActions.filter((action) => action.instrumentId === instrumentId)
}

export function isIncludedInValuation(status: PositionValuationStatus): boolean {
  return status === 'EXPLAINED' || status === 'CORPORATE_ACTION_EXPLAINED'
}

function hasBlockingTransaction(
  transactions: readonly Transaction[],
  instrumentId: EntityId,
): boolean {
  return transactions.some(
    (transaction) =>
      transaction.instrumentId === instrumentId &&
      isBlockingTransaction(transaction.type),
  )
}

function isBlockingTransaction(
  type: TransactionType,
): type is (typeof BLOCKING_TRANSACTION_TYPES)[number] {
  for (const candidate of BLOCKING_TRANSACTION_TYPES) {
    if (candidate === type) return true
  }
  return false
}

function unexplained(
  base: {
    instrumentId: EntityId
    openingQuantity: DecimalString
    closingQuantity: DecimalString
    openingValue: DecimalString
    closingValue: DecimalString
  },
  status: PositionValuationStatus,
  reason: string,
): PositionValuationResult {
  return {
    ...base,
    valuationChange: null,
    status,
    reason,
  }
}
