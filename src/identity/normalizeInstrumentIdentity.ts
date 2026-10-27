import Decimal from 'decimal.js'
import type { CorporateAction } from '../domain/corporateAction'
import type { Instrument } from '../domain/instrument'
import type { Position } from '../domain/snapshot'
import type { Transaction } from '../domain/transaction'
import { instrumentIdentityTransitions, type InstrumentIdentityTransition } from './instrumentIdentityTransitions'

export interface IdentityMapping {
  rawInstrumentId: string
  rawTicker: string
  economicInstrumentId: string
  economicTicker: string
  quantityMultiplier: string
  transitions: readonly InstrumentIdentityTransition[]
}

export interface IdentityReconciliationAudit {
  mappings: IdentityMapping[]
  appliedTransitions: readonly InstrumentIdentityTransition[]
  quantities: { rawInstrumentId: string; rawTicker: string; economicInstrumentId: string; status: 'RECONCILED' | 'QUANTITY_MISMATCH'; difference: string }[]
}

export interface IdentityNormalizationInput {
  closingDate: string
  instruments: readonly Pick<Instrument, 'id' | 'ticker'>[]
  openingPositions: readonly Position[]
  closingPositions: readonly Position[]
  transactions: readonly Transaction[]
  corporateActions: readonly CorporateAction[]
  transitions?: readonly InstrumentIdentityTransition[]
}

/** Pure analysis projection: no rows, descriptions, cash amounts or persisted objects are changed. */
export function normalizeInstrumentIdentity(input: IdentityNormalizationInput) {
  const transitions = input.transitions ?? instrumentIdentityTransitions
  for (const transition of transitions) {
    if (!new Decimal(transition.ratio).isFinite() || !new Decimal(transition.ratio).gt(0)) throw new Error('El ratio de transición debe ser positivo y finito.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transition.effectiveDate) || !Number.isFinite(Date.parse(transition.effectiveDate))) throw new Error('Fecha de transición inválida.')
  }
  const active = transitions.filter(row => row.effectiveDate <= input.closingDate)
  function resolve(ticker: string) {
    let multiplier = new Decimal(1)
    const used: InstrumentIdentityTransition[] = []
    const visited = new Set<string>()
    while (true) {
      if (visited.has(ticker)) throw new Error('Ciclo en las transiciones de instrumento.')
      visited.add(ticker)
      const next = active.filter(row => row.fromTicker === ticker)
      if (next.length > 1) throw new Error(`Transición ambigua para ${ticker}.`)
      const transition = next[0]
      if (!transition) return { ticker, multiplier, used }
      if (used.length && transition.effectiveDate < used[used.length - 1]!.effectiveDate) throw new Error('Cadena de transiciones fuera de orden temporal.')
      used.push(transition)
      multiplier = multiplier.times(transition.ratio)
      ticker = transition.toTicker
    }
  }
  const rawIds = [...new Set([
    ...input.openingPositions.map(row => row.instrumentId), ...input.closingPositions.map(row => row.instrumentId),
    ...input.transactions.map(row => row.instrumentId).filter((id): id is string => id !== null),
  ])]
  const catalog = new Map(input.instruments.map(row => [row.id, row]))
  const resolved = rawIds.map(id => {
    const instrument = catalog.get(id)
    if (!instrument) throw new Error(`Falta el instrumento ${id} para resolver su identidad.`)
    return { id, rawTicker: instrument.ticker, ...resolve(instrument.ticker) }
  })
  const mappings: IdentityMapping[] = resolved.map(row => {
    const target = input.instruments.filter(instrument => instrument.ticker === row.ticker)
    if (target.length > 1) throw new Error(`Identidad económica ambigua para ${row.ticker}.`)
    const representative = target[0]?.id ?? resolved.filter(other => other.ticker === row.ticker).map(other => other.id).sort()[0]!
    return { rawInstrumentId: row.id, rawTicker: row.rawTicker, economicInstrumentId: representative,
      economicTicker: row.ticker, quantityMultiplier: row.multiplier.toString(), transitions: row.used }
  })
  const byId = new Map(mappings.map(row => [row.rawInstrumentId, row]))
  const mapping = (id: string) => {
    const found = byId.get(id)
    if (!found) throw new Error(`Falta la identidad de ${id}.`)
    return found
  }
  function positions(rows: readonly Position[]): Position[] {
    const grouped = new Map<string, Position>()
    for (const row of rows) {
      const identity = mapping(row.instrumentId)
      const projected = { ...row, instrumentId: identity.economicInstrumentId,
        quantity: identity.quantityMultiplier === '1' ? row.quantity : new Decimal(row.quantity).times(identity.quantityMultiplier).toString(),
        unitPrice: identity.quantityMultiplier === '1' ? row.unitPrice : new Decimal(row.unitPrice).div(identity.quantityMultiplier).toString() }
      const previous = grouped.get(projected.instrumentId)
      if (!previous) { grouped.set(projected.instrumentId, projected); continue }
      if (previous.currency !== projected.currency) throw new Error('No se pueden combinar posiciones en distintas monedas.')
      const quantity = new Decimal(previous.quantity).plus(projected.quantity)
      const priced = new Decimal(previous.unitPrice).times(previous.quantity).plus(new Decimal(projected.unitPrice).times(projected.quantity))
      grouped.set(projected.instrumentId, { ...previous, quantity: quantity.toString(),
        unitPrice: quantity.isZero() ? '0' : priced.div(quantity).toString(),
        marketValue: new Decimal(previous.marketValue).plus(projected.marketValue).toString() })
    }
    return [...grouped.values()]
  }
  function scale(value: string | null, multiplier: string) { return value === null || multiplier === '1' ? value : new Decimal(value).times(multiplier).toString() }
  return {
    openingPositions: positions(input.openingPositions), closingPositions: positions(input.closingPositions),
    transactions: input.transactions.map(row => {
      if (!row.instrumentId) return { ...row }
      const identity = mapping(row.instrumentId)
      return { ...row, instrumentId: identity.economicInstrumentId, quantity: scale(row.quantity, identity.quantityMultiplier),
        unitPrice: row.unitPrice === null || identity.quantityMultiplier === '1' ? row.unitPrice : new Decimal(row.unitPrice).div(identity.quantityMultiplier).toString() }
    }),
    corporateActions: input.corporateActions.map(row => {
      const identity = byId.get(row.instrumentId)
      if (!identity) return { ...row }
      return { ...row, instrumentId: identity.economicInstrumentId,
        quantityBefore: scale(row.quantityBefore, identity.quantityMultiplier),
        quantityChange: scale(row.quantityChange, identity.quantityMultiplier),
        quantityAfter: scale(row.quantityAfter, identity.quantityMultiplier) }
    }),
    mappings,
    appliedTransitions: [...new Set(mappings.flatMap(row => [...row.transitions]))],
  }
}