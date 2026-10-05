import type { EntityId } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import type { CashBalance, PortfolioSnapshot, PortfolioSnapshotAggregate, Position } from '../../domain/snapshot'
import type { ParsedCashBalance, ParsedConsolidatedPosition, ParsedPosition } from '../../parsers/models/parsedConsolidatedPosition'
import { AdapterError } from '../adapterError'
import { instrumentIdFromTicker } from '../instrumentIdentity'

export interface SnapshotAdaptationContext {
  portfolioId: EntityId
  periodId: EntityId
  createdAt: string
}

/**
 * Foto parseada → snapshot de dominio.
 * totalValue es el total impreso. No se reemplaza por la suma del detalle.
 * Las tenencias copian cantidad y Valor Actual. No se recalculan.
 */
export function adaptConsolidatedPosition(
  parsed: ParsedConsolidatedPosition,
  context: SnapshotAdaptationContext,
): PortfolioSnapshotAggregate {
  const snapshotId = `snapshot:${context.portfolioId}:${parsed.snapshotDate}`
  const snapshot: PortfolioSnapshot = {
    id: snapshotId,
    portfolioId: context.portfolioId,
    periodId: context.periodId,
    date: parsed.snapshotDate,
    totalValue: parsed.reportedTotal,
    currency: 'ARS',
    sourceDocumentId: null,
    createdAt: context.createdAt,
  }

  return {
    snapshot,
    positions: parsed.positions.map((position) => toPosition(position, snapshotId)),
    cashBalances: parsed.cashBalances.map((balance) => toCashBalance(balance, snapshotId)),
  }
}

function toPosition(position: ParsedPosition, snapshotId: EntityId): Position {
  if (position.unitPrice === null) {
    throw new AdapterError(`La tenencia ${position.ticker} no tiene precio impreso.`)
  }

  return {
    id: `position:${snapshotId}:${position.ticker}`,
    snapshotId,
    instrumentId: instrumentIdFromTicker(position.ticker),
    quantity: position.quantity,
    unitPrice: position.unitPrice,
    marketValue: position.marketValue,
    currency: 'ARS' satisfies CurrencyCode,
  }
}

/**
 * ARS usa el importe impreso.
 * USD usa el valor en pesos ya calculado por el parser con el tipo de cambio
 * del documento: la Posición Consolidada no imprime esa columna.
 */
function toCashBalance(balance: ParsedCashBalance, snapshotId: EntityId): CashBalance {
  return {
    id: `cash:${snapshotId}:${balance.currency}`,
    snapshotId,
    currency: balance.currency,
    amount: balance.amount,
    fxRate: balance.fxRate,
    valueInBaseCurrency: valueInBaseCurrency(balance),
  }
}

function valueInBaseCurrency(balance: ParsedCashBalance): string | null {
  if (balance.currency === 'ARS') return balance.amount
  return balance.calculatedValueInBaseCurrency
}
