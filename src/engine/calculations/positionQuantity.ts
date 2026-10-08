import type { DecimalString, EntityId } from '../../domain/common'
import type { CorporateAction } from '../../domain/corporateAction'
import type { Position } from '../../domain/snapshot'
import type { Transaction, TransactionType } from '../../domain/transaction'
import { AnalysisError } from '../errors/analysisErrors'
import { parseDecimal, zeroDecimal } from '../money'

export type PositionQuantityStatus = 'RECONCILED' | 'QUANTITY_MISMATCH'

export interface PositionQuantityReconciliation {
  instrumentId: EntityId
  openingQuantity: DecimalString
  boughtQuantity: DecimalString
  soldQuantity: DecimalString
  subscribedQuantity: DecimalString
  redeemedQuantity: DecimalString
  corporateActionQuantity: DecimalString
  expectedClosingQuantity: DecimalString
  actualClosingQuantity: DecimalString
  difference: DecimalString
  status: PositionQuantityStatus
}

/**
 * Cierra la cantidad de cada instrumento.
 * Una fila ausente en la apertura o en el cierre vale cero:
 * una posición nueva o vendida por completo sigue en el análisis.
 */
export function reconcilePositionQuantities(input: {
  openingPositions: readonly Position[]
  closingPositions: readonly Position[]
  transactions: readonly Transaction[]
  corporateActions: readonly CorporateAction[]
}): PositionQuantityReconciliation[] {
  const opening = index(input.openingPositions)
  const closing = index(input.closingPositions)
  const instrumentIds = [
    ...new Set([
      ...opening.keys(),
      ...closing.keys(),
      ...input.transactions.map((movement) => movement.instrumentId).filter((id): id is EntityId => id !== null),
    ]),
  ].sort()

  return instrumentIds.map((instrumentId) => {
    const openingPosition = input.openingPositions.find((position) => position.instrumentId === instrumentId)
    const closingPosition = input.closingPositions.find((position) => position.instrumentId === instrumentId)
    const openingQuantity = opening.get(instrumentId) ?? zeroDecimal()
    const actualClosing = closing.get(instrumentId) ?? zeroDecimal()
    const movements = input.transactions.filter((movement) => movement.instrumentId === instrumentId)
    const bought = sumQuantity(movements, 'BUY')
    const sold = sumQuantity(movements, 'SELL')
    const subscribed = sumQuantity(movements, 'FUND_SUBSCRIPTION')
    const redeemed = sumQuantity(movements, 'FUND_REDEMPTION')
    const actions = input.corporateActions.filter((action) => action.instrumentId === instrumentId)
    const corporate = actions.reduce((total, action) => total.plus(action.quantityChange ?? '0'), zeroDecimal())
    const expected = openingQuantity.plus(bought).minus(sold).plus(subscribed).minus(redeemed).plus(corporate)
    const difference = actualClosing.minus(expected)
    const scale = maxScale([
      openingPosition?.quantity,
      closingPosition?.quantity,
      ...movements.map((movement) => movement.quantity),
      ...actions.map((action) => action.quantityChange),
    ])
    return {
      instrumentId,
      openingQuantity: formatQuantity(openingQuantity, scaleOf(openingPosition?.quantity)),
      boughtQuantity: formatQuantity(bought, scaleOfType(movements, 'BUY')),
      soldQuantity: formatQuantity(sold, scaleOfType(movements, 'SELL')),
      subscribedQuantity: formatQuantity(subscribed, scaleOfType(movements, 'FUND_SUBSCRIPTION')),
      redeemedQuantity: formatQuantity(redeemed, scaleOfType(movements, 'FUND_REDEMPTION')),
      corporateActionQuantity: formatQuantity(corporate, scaleOf(actions[0]?.quantityChange)),
      expectedClosingQuantity: formatQuantity(expected, scale),
      actualClosingQuantity: formatQuantity(actualClosing, scaleOf(closingPosition?.quantity)),
      difference: formatQuantity(difference, scale),
      status: difference.isZero() ? 'RECONCILED' : 'QUANTITY_MISMATCH',
    }
  })
}

function index(positions: readonly Position[]): Map<EntityId, ReturnType<typeof parseDecimal>> {
  const indexed = new Map<EntityId, ReturnType<typeof parseDecimal>>()
  for (const position of positions) {
    if (indexed.has(position.instrumentId)) {
      throw new AnalysisError(`El instrumento ${position.instrumentId} está repetido en el snapshot.`)
    }
    indexed.set(position.instrumentId, parseDecimal(position.quantity))
  }
  return indexed
}

function sumQuantity(movements: readonly Transaction[], type: TransactionType) {
  return movements
    .filter((movement) => movement.type === type && movement.quantity !== null)
    .reduce((total, movement) => total.plus(parseDecimal(movement.quantity ?? '0').abs()), zeroDecimal())
}

function formatQuantity(value: ReturnType<typeof parseDecimal>, scale = 0): DecimalString {
  if (value.isZero()) return '0'
  return value.toFixed(Math.max(value.decimalPlaces(), scale))
}

function scaleOfType(movements: readonly Transaction[], type: TransactionType): number {
  return maxScale(movements.filter((movement) => movement.type === type).map((movement) => movement.quantity))
}

function scaleOf(value: string | null | undefined): number {
  if (!value || !value.includes('.')) return 0
  return value.split('.')[1]?.length ?? 0
}

function maxScale(values: readonly (string | null | undefined)[]): number {
  return values.reduce<number>((scale, value) => Math.max(scale, scaleOf(value)), 0)
}
