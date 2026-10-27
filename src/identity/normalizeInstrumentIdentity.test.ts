import { describe, expect, it } from 'vitest'
import type { Position } from '../domain/snapshot'
import type { Transaction } from '../domain/transaction'
import { analyzePositionValueFlows } from '../engine/calculations/positionValueFlow'
import { normalizeInstrumentIdentity } from './normalizeInstrumentIdentity'
import { instrumentIdentityTransitions, type InstrumentIdentityTransition } from './instrumentIdentityTransitions'

const position = (instrumentId: string, quantity: string, unitPrice: string, marketValue: string): Position => ({
  id: `position-${instrumentId}`, snapshotId: 'snapshot', instrumentId, quantity, unitPrice, marketValue, currency: 'ARS',
})
const sale: Transaction = {
  id: 'sale', portfolioId: 'portfolio', periodId: 'period', instrumentId: 'old', date: '2026-04-06',
  type: 'SELL', quantity: '-11', unitPrice: '15677.2727272727', grossAmount: '172450', netAmount: '171302.35',
  fees: null, taxes: null, currency: 'ARS', fxRate: null, sourceDocumentId: 'document',
  sourceReference: 'Boleto / 3803745 / VENTA / 1 / BITF / $', createdAt: '2026-04-30',
}
const input = () => ({
  closingDate: '2026-04-30', instruments: [{ id: 'old', ticker: 'BITF' }, { id: 'new', ticker: 'KEEL' }],
  openingPositions: [position('new', '11', '14430', '158730')], closingPositions: [] as Position[],
  transactions: [{ ...sale }], corporateActions: [],
})
const flow = (normalized: ReturnType<typeof normalizeInstrumentIdentity>) => analyzePositionValueFlows({
  ...normalized, baseCurrency: 'ARS',
})

describe('transiciones explícitas de identidad económica', () => {
  it('reconcilia KEEL en apertura y venta BITF sin mutar raw ni crear operaciones', () => {
    const original = input()
    const before = structuredClone(original)
    const normalized = normalizeInstrumentIdentity(original)
    expect(original).toEqual(before)
    expect(original.transactions[0]).toMatchObject({ instrumentId: 'old', quantity: '-11', sourceReference: sale.sourceReference })
    expect(normalized.transactions).toHaveLength(1)
    expect(normalized.transactions[0]).toMatchObject({ id: 'sale', instrumentId: 'new', quantity: '-11', grossAmount: '172450', netAmount: '171302.35', sourceReference: sale.sourceReference })
    expect(normalized.corporateActions).toEqual([])
    const [result] = flow(normalized)
    expect(result.quantity.status).toBe('RECONCILED')
    expect(result.periodPositionResult).toBe('13720.00')
    expect(normalized.appliedTransitions).toEqual(instrumentIdentityTransitions)
  })
  it('no aplica la transición antes de effectiveDate y sí la aplica en la fecha efectiva', () => {
    const before = normalizeInstrumentIdentity({ ...input(), closingDate: '2026-04-05' })
    expect(before.transactions[0].instrumentId).toBe('old')
    expect(before.appliedTransitions).toEqual([])
    expect(normalizeInstrumentIdentity({ ...input(), closingDate: '2026-04-06' }).transactions[0].instrumentId).toBe('new')
  })
  it.each(['2', '0.25'])('aplica ratio %s sin crear P/L y conserva importes monetarios', ratio => {
    const transition: InstrumentIdentityTransition = { ...instrumentIdentityTransitions[0], ratio }
    const normalized = normalizeInstrumentIdentity({ ...input(), transitions: [transition],
      openingPositions: [position('old', '4', '25', '100')],
      closingPositions: [position('new', ratio === '2' ? '8' : '1', ratio === '2' ? '12.5' : '100', '100')], transactions: [],
    })
    expect(flow(normalized)[0]).toMatchObject({ periodPositionResult: '0.00', quantity: { status: 'RECONCILED' } })
    expect(normalized.openingPositions[0].marketValue).toBe('100')
  })
  it('escala cantidad y precio de una operación sin cambiar bruto, neto ni referencia', () => {
    const normalized = normalizeInstrumentIdentity({ ...input(), transitions: [{ ...instrumentIdentityTransitions[0], ratio: '2' }] })
    expect(normalized.transactions[0]).toMatchObject({ quantity: '-22', grossAmount: sale.grossAmount, netAmount: sale.netAmount, sourceReference: sale.sourceReference })
  })
  it('compone ratios de una cadena y no mezcla símbolos desconocidos', () => {
    const first = { ...instrumentIdentityTransitions[0], ratio: '2' }
    const second = { ...first, fromTicker: 'KEEL', toTicker: 'NEXT', effectiveDate: '2026-04-15', ratio: '3' }
    const normalized = normalizeInstrumentIdentity({ ...input(), instruments: [...input().instruments, { id: 'next', ticker: 'NEXT' }], transitions: [first, second] })
    expect(normalized.transactions[0]).toMatchObject({ instrumentId: 'next', quantity: '-66' })
    expect(normalizeInstrumentIdentity({ ...input(), transitions: [] }).transactions[0].instrumentId).toBe('old')
  })
  it('rechaza ratio inválido, ciclos y destinos ambiguos', () => {
    expect(() => normalizeInstrumentIdentity({ ...input(), transitions: [{ ...instrumentIdentityTransitions[0], ratio: '0' }] })).toThrow(/ratio/)
    expect(() => normalizeInstrumentIdentity({ ...input(), transitions: [instrumentIdentityTransitions[0], { ...instrumentIdentityTransitions[0], fromTicker: 'KEEL', toTicker: 'BITF' }] })).toThrow(/Ciclo/)
    expect(() => normalizeInstrumentIdentity({ ...input(), instruments: [...input().instruments, { id: 'ambiguous', ticker: 'KEEL' }] })).toThrow(/ambigua/)
  })
})