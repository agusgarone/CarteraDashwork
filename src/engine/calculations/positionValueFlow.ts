import type { DecimalString, EntityId } from '../../domain/common'
import type { CorporateAction } from '../../domain/corporateAction'
import type { CurrencyCode } from '../../domain/currency'
import type { Position } from '../../domain/snapshot'
import type { Transaction } from '../../domain/transaction'
import type { CashMovementLeg } from './cashLedger'
import { formatExact, parseDecimal, zeroDecimal } from '../money'
import {
  reconcilePositionQuantities,
  type PositionQuantityReconciliation,
} from './positionQuantity'
import {
  allocateTransactionCost,
  economicTradeCost,
  type TransactionCostBreakdown,
} from './transactionCost'

export type PositionFlowStatus =
  | 'VALUATION_EXPLAINED'
  | 'QUANTITY_RECONCILED_VALUE_PENDING'
  | 'MISSING_TRANSACTION_FX'
  | 'QUANTITY_MISMATCH'
  | 'CORPORATE_ACTION_EXPLAINED'
  | 'CLOSED_DURING_PERIOD'
  | 'OPENED_DURING_PERIOD'

export interface PositionCurrencyCost {
  currency: CurrencyCode
  breakdown: TransactionCostBreakdown
}

export interface PositionValueFlowAnalysis {
  instrumentId: EntityId
  quantity: PositionQuantityReconciliation
  openingValue: DecimalString | null
  closingValue: DecimalString | null
  acquisitionFlows: DecimalString | null
  disposalFlows: DecimalString | null
  costs: PositionCurrencyCost[]
  periodPositionResult: DecimalString | null
  valueStatus: PositionFlowStatus
  reason: string | null
}

const SAFE_RESULT = new Set<PositionFlowStatus>([
  'VALUATION_EXPLAINED',
  'CORPORATE_ACTION_EXPLAINED',
  'CLOSED_DURING_PERIOD',
  'OPENED_DURING_PERIOD',
])

export function isSafePositionResult(status: PositionFlowStatus): boolean {
  return SAFE_RESULT.has(status)
}

/**
 * Resultado de la posición ajustado por flujos de compra y venta.
 * El bruto del instrumento es el flujo. El neto de caja queda para los costos.
 * Un precio en otra moneda no se convierte.
 */
export function analyzePositionValueFlows(input: {
  openingPositions: readonly Position[]
  closingPositions: readonly Position[]
  transactions: readonly Transaction[]
  corporateActions: readonly CorporateAction[]
  cashLegs?: readonly CashMovementLeg[]
  baseCurrency: CurrencyCode
}): PositionValueFlowAnalysis[] {
  const quantities = reconcilePositionQuantities(input)
  const opening = indexPositions(input.openingPositions)
  const closing = indexPositions(input.closingPositions)
  const legs = input.cashLegs ?? []

  return quantities.map((quantity) => {
    const movements = input.transactions.filter((movement) => movement.instrumentId === quantity.instrumentId)
    const openingPosition = opening.get(quantity.instrumentId) ?? null
    const closingPosition = closing.get(quantity.instrumentId) ?? null
    const openingValue = openingPosition ? parseDecimal(openingPosition.marketValue) : zeroDecimal()
    const closingValue = closingPosition ? parseDecimal(closingPosition.marketValue) : zeroDecimal()
    const trades = movements.filter((movement) => movement.type === 'BUY' || movement.type === 'SELL')
    const funds = movements.filter(
      (movement) => movement.type === 'FUND_SUBSCRIPTION' || movement.type === 'FUND_REDEMPTION',
    )
    const costs = tradeCosts(trades, legs)

    if (quantity.status === 'QUANTITY_MISMATCH') {
      return pending(quantity, openingPosition, closingPosition, costs, 'QUANTITY_MISMATCH', 'La cantidad no cierra.')
    }

    const foreignTrade = trades.find((movement) => movement.currency !== input.baseCurrency)
    if (foreignTrade) {
      return pending(
        quantity,
        openingPosition,
        closingPosition,
        costs,
        'MISSING_TRANSACTION_FX',
        'Pendiente: falta tipo de cambio de la operación.',
      )
    }

    const missingGross = [...trades, ...funds].find((movement) => flowAmount(movement) === null)
    if (missingGross) {
      return pending(
        quantity,
        openingPosition,
        closingPosition,
        costs,
        'QUANTITY_RECONCILED_VALUE_PENDING',
        'La cantidad cierra y falta el bruto de la operación.',
      )
    }

    const acquisition = sumFlows(trades, 'BUY').plus(sumFlows(funds, 'FUND_SUBSCRIPTION'))
    const disposal = sumFlows(trades, 'SELL').plus(sumFlows(funds, 'FUND_REDEMPTION'))
    const result = closingValue.minus(openingValue).minus(acquisition).plus(disposal)
    const corporateOnly =
      trades.length === 0 &&
      funds.length === 0 &&
      input.corporateActions.some(
        (action) => action.instrumentId === quantity.instrumentId && action.type === 'STOCK_DIVIDEND',
      )
    const opened = parseDecimal(quantity.openingQuantity).isZero() && !parseDecimal(quantity.actualClosingQuantity).isZero()
    const closed = parseDecimal(quantity.actualClosingQuantity).isZero() && !parseDecimal(quantity.openingQuantity).isZero()
    const valueStatus: PositionFlowStatus = corporateOnly
      ? 'CORPORATE_ACTION_EXPLAINED'
      : opened
        ? 'OPENED_DURING_PERIOD'
        : closed
          ? 'CLOSED_DURING_PERIOD'
          : 'VALUATION_EXPLAINED'

    return {
      instrumentId: quantity.instrumentId,
      quantity,
      openingValue: formatExact(openingValue),
      closingValue: formatExact(closingValue),
      acquisitionFlows: formatExact(acquisition),
      disposalFlows: formatExact(disposal),
      costs,
      periodPositionResult: formatExact(result),
      valueStatus,
      reason: null,
    }
  })
}

export function baseCurrencyCost(flow: PositionValueFlowAnalysis, baseCurrency: CurrencyCode) {
  return flow.costs
    .filter((cost) => cost.currency === baseCurrency)
    .reduce((total, cost) => total.plus(cost.breakdown.total), zeroDecimal())
}

function pending(
  quantity: PositionQuantityReconciliation,
  opening: Position | null,
  closing: Position | null,
  costs: PositionCurrencyCost[],
  valueStatus: PositionFlowStatus,
  reason: string,
): PositionValueFlowAnalysis {
  return {
    instrumentId: quantity.instrumentId,
    quantity,
    openingValue: opening ? formatExact(parseDecimal(opening.marketValue)) : null,
    closingValue: closing ? formatExact(parseDecimal(closing.marketValue)) : null,
    acquisitionFlows: null,
    disposalFlows: null,
    costs,
    periodPositionResult: null,
    valueStatus,
    reason,
  }
}

function tradeCosts(trades: readonly Transaction[], legs: readonly CashMovementLeg[]): PositionCurrencyCost[] {
  const byCurrency = new Map<CurrencyCode, TransactionCostBreakdown[]>()
  for (const trade of trades) {
    const reference = operationReference(trade)
    const matched = legs.filter(
      (leg) => leg.role === 'TRADE_SETTLEMENT' && reference !== null && leg.operationId === reference,
    )
    const rows = matched.length > 0 ? matched : fallbackRow(trade)
    for (const row of rows) {
      const gross = row.currency === trade.currency ? flowAmount(trade) ?? '0' : '0'
      const total = economicTradeCost(trade.type === 'SELL' ? 'SELL' : 'BUY', gross, row.amount)
      if (parseDecimal(total).isZero()) continue
      const breakdown = allocateTransactionCost(
        {
          commission: row.commission,
          vat: row.vat,
          marketFees: row.marketFees,
          taxes: row.taxComponent,
        },
        total,
      )
      const current = byCurrency.get(row.currency) ?? []
      current.push(breakdown)
      byCurrency.set(row.currency, current)
    }
  }

  return [...byCurrency.entries()].map(([currency, breakdowns]) => ({
    currency,
    breakdown: sumBreakdowns(breakdowns),
  }))
}

function sumBreakdowns(breakdowns: readonly TransactionCostBreakdown[]): TransactionCostBreakdown {
  const total = (field: keyof TransactionCostBreakdown) =>
    formatExact(breakdowns.reduce((sum, breakdown) => sum.plus(breakdown[field]), zeroDecimal()))
  return {
    commission: total('commission'),
    vat: total('vat'),
    marketFees: total('marketFees'),
    taxes: total('taxes'),
    other: total('other'),
    total: total('total'),
  }
}

function fallbackRow(trade: Transaction): CashMovementLeg[] {
  if (trade.netAmount === null) return []
  return [
    {
      operationId: operationReference(trade),
      operationType: trade.type,
      currency: trade.currency,
      amount: trade.netAmount,
      date: trade.date,
      role: 'TRADE_SETTLEMENT',
    },
  ]
}

function sumFlows(movements: readonly Transaction[], type: Transaction['type']) {
  return movements
    .filter((movement) => movement.type === type)
    .reduce((total, movement) => total.plus(parseDecimal(flowAmount(movement) ?? '0').abs()), zeroDecimal())
}

function flowAmount(movement: Transaction): DecimalString | null {
  return movement.grossAmount ?? movement.netAmount
}

export interface PendingAttribution {
  positions: {
    instrumentId: EntityId
    status: PositionFlowStatus
    reason: string
  }[]
  cashPerformancePending: boolean
}

/**
 * Suma lo que ya se puede explicar en moneda base.
 * Incluye el resultado de las posiciones seguras, sus costos en pesos
 * y los costos en pesos de las operaciones que todavía no tienen tipo de cambio.
 * No convierte dividendos ni costos en otra moneda.
 */
export function summarizePartialAttribution(input: {
  flows: readonly PositionValueFlowAnalysis[]
  transactions: readonly Transaction[]
  baseCurrency: CurrencyCode
  cashPerformancePending: boolean
}): { partialExplainedResult: DecimalString; pendingAttribution: PendingAttribution } {
  let total = zeroDecimal()
  for (const flow of input.flows) {
    if (flow.periodPositionResult !== null && isSafePositionResult(flow.valueStatus)) {
      total = total.plus(flow.periodPositionResult)
    }
    total = total.minus(baseCurrencyCost(flow, input.baseCurrency))
  }
  for (const movement of input.transactions) {
    if (movement.currency !== input.baseCurrency || movement.netAmount === null) continue
    if (
      movement.type === 'DIVIDEND' ||
      movement.type === 'INTEREST' ||
      movement.type === 'TAX' ||
      movement.type === 'FEE'
    ) {
      total = total.plus(movement.netAmount)
    }
  }
  return {
    partialExplainedResult: formatExact(total),
    pendingAttribution: {
      positions: input.flows
        .filter((flow) => !isSafePositionResult(flow.valueStatus))
        .map((flow) => ({
          instrumentId: flow.instrumentId,
          status: flow.valueStatus,
          reason: flow.reason ?? flow.valueStatus,
        })),
      cashPerformancePending: input.cashPerformancePending,
    },
  }
}

function operationReference(movement: Transaction): string | null {
  const source = movement.sourceReference ?? ''
  const match = source.match(/\/\s*(\d+)\s*\//)
  return match?.[1] ?? null
}

function indexPositions(positions: readonly Position[]): Map<EntityId, Position> {
  return new Map(positions.map((position) => [position.instrumentId, position]))
}
