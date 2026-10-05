import type { EntityId } from '../../domain/common'
import type { CorporateAction } from '../../domain/corporateAction'
import type { Transaction } from '../../domain/transaction'
import type {
  NormalizedCorporateAction,
  NormalizedTransaction,
  ParsedMonthlyAccount,
} from '../../parsers/models/parsedMonthlyAccount'
import { instrumentIdFromTicker } from '../instrumentIdentity'

export interface MovementAdaptationContext {
  portfolioId: EntityId
  periodId: EntityId
  createdAt: string
}

export interface AdaptedMonthlyAccount {
  transactions: Transaction[]
  corporateActions: CorporateAction[]
}

/**
 * Movimientos parseados → dominio.
 * Neto y bruto conservan el signo del documento, también cuando es negativo.
 * El adapter no aplica valor absoluto ni inventa un tipo de cambio.
 */
export function adaptMonthlyAccount(
  parsed: ParsedMonthlyAccount,
  context: MovementAdaptationContext,
): AdaptedMonthlyAccount {
  return {
    transactions: parsed.transactions.map((movement, index) => toTransaction(movement, index, context)),
    corporateActions: parsed.corporateActions.map((action, index) => toCorporateAction(action, index, context)),
  }
}

function toTransaction(
  movement: NormalizedTransaction,
  index: number,
  context: MovementAdaptationContext,
): Transaction {
  const ticker = movement.ticker ?? 'none'
  return {
    id: `transaction:${movement.date}:${movement.type}:${movement.currency}:${ticker}:${index}`,
    portfolioId: context.portfolioId,
    periodId: context.periodId,
    instrumentId: movement.ticker === null ? null : instrumentIdFromTicker(movement.ticker),
    date: movement.date,
    type: movement.type,
    quantity: movement.quantity,
    unitPrice: movement.unitPrice,
    grossAmount: movement.grossAmount,
    netAmount: movement.netAmount,
    fees: movement.fees,
    taxes: movement.taxes,
    currency: movement.currency,
    fxRate: movement.fxRate,
    sourceDocumentId: null,
    sourceReference: movement.sourceReference,
    createdAt: context.createdAt,
  }
}

function toCorporateAction(
  action: NormalizedCorporateAction,
  index: number,
  context: MovementAdaptationContext,
): CorporateAction {
  return {
    id: `corporate-action:${action.date}:${action.type}:${action.ticker}:${index}`,
    portfolioId: context.portfolioId,
    periodId: context.periodId,
    instrumentId: instrumentIdFromTicker(action.ticker),
    date: action.date,
    type: action.type,
    quantityBefore: action.quantityBefore,
    quantityChange: action.quantityChange,
    quantityAfter: action.quantityAfter,
    ratio: action.ratio,
    description: action.description,
    sourceDocumentId: null,
    createdAt: context.createdAt,
  }
}
