import { describe, expect, it } from 'vitest'
import type { CorporateAction } from '../domain/corporateAction'
import type { Position } from '../domain/snapshot'
import type { Transaction, TransactionType } from '../domain/transaction'
import {
  analyzePositionValuations,
  calculateTotalValuationChange,
} from './calculations/positionValuation'

describe('analyzePositionValuations', () => {
  it('explica META por la diferencia de marketValue', () => {
    const result = analyze('meta', '13', '475020.00', '13', '496340.00')

    expect(result.status).toBe('EXPLAINED')
    expect(result.valuationChange).toBe('21320.00')
    expect(result.reason).toBeNull()
  })

  it('explica una baja de AMZN', () => {
    const result = analyze('amzn', '353', '1051058.00', '353', '1021935.00')

    expect(result.status).toBe('EXPLAINED')
    expect(result.valuationChange).toBe('-29123.00')
  })

  it('trata 13 y 13.000000 como la misma cantidad', () => {
    const result = analyze('meta', '13', '475020.00', '13.000000', '496340.00')

    expect(result.status).toBe('EXPLAINED')
    expect(result.valuationChange).toBe('21320.00')
  })

  it('no explica una posición que tuvo una compra aunque la cantidad coincida', () => {
    const result = analyze('meta', '10', '100.00', '10', '130.00', {
      transactions: [trade('BUY', 'meta')],
    })

    expect(result.status).toBe('HAS_PERIOD_TRANSACTION')
    expect(result.valuationChange).toBeNull()
  })

  it('no explica una posición que tuvo una venta', () => {
    const result = analyze('meta', '10', '100.00', '10', '130.00', {
      transactions: [trade('SELL', 'meta')],
    })

    expect(result.status).toBe('HAS_PERIOD_TRANSACTION')
    expect(result.valuationChange).toBeNull()
  })

  it('deja YPF sin valuación simple cuando hay dividendo en acciones', () => {
    const result = analyze('ypf', '14', '1160600.00', '140', '1155700.00', {
      corporateActions: [stockDividend('ypf')],
    })

    expect(result.status).toBe('HAS_CORPORATE_ACTION')
    expect(result.valuationChange).toBeNull()
  })

  it('no infiere una operación si la cantidad cambió sin evento', () => {
    const result = analyze('meta', '10', '100.00', '12', '140.00')

    expect(result.status).toBe('QUANTITY_CHANGED')
    expect(result.valuationChange).toBeNull()
  })

  it('no resta cero cuando la posición solo existe al cierre', () => {
    const [result] = analyzePositionValuations({
      openingPositions: [],
      closingPositions: [holding('new', 'close', '5', '80.00')],
      transactions: [],
      corporateActions: [],
      currency: 'ARS',
    })

    expect(result?.status).toBe('MISSING_OPENING_POSITION')
    expect(result?.openingValue).toBeNull()
    expect(result?.valuationChange).toBeNull()
    expect(result?.valuationChange).not.toBe('80.00')
  })

  it('no asume una venta total cuando la posición solo existe al inicio', () => {
    const [result] = analyzePositionValuations({
      openingPositions: [holding('old', 'open', '5', '80.00')],
      closingPositions: [],
      transactions: [],
      corporateActions: [],
      currency: 'ARS',
    })

    expect(result?.status).toBe('MISSING_CLOSING_POSITION')
    expect(result?.closingValue).toBeNull()
    expect(result?.valuationChange).toBeNull()
    expect(result?.valuationChange).not.toBe('-80.00')
  })

  it('suma solo META, AAPL y AMZN', () => {
    const results = analyzePositionValuations({
      openingPositions: [
        holding('amzn', 'open', '353', '1051058.00'),
        holding('meta', 'open', '13', '475020.00'),
        holding('aapl', 'open', '28', '680680.00'),
      ],
      closingPositions: [
        holding('aapl', 'close', '28', '708960.00'),
        holding('amzn', 'close', '353', '1021935.00'),
        holding('meta', 'close', '13', '496340.00'),
      ],
      transactions: [],
      corporateActions: [],
      currency: 'ARS',
    })

    expect(results.map((result) => result.instrumentId)).toEqual(['aapl', 'amzn', 'meta'])
    expect(results.find((result) => result.instrumentId === 'meta')?.valuationChange).toBe('21320.00')
    expect(results.find((result) => result.instrumentId === 'aapl')?.valuationChange).toBe('28280.00')
    expect(results.find((result) => result.instrumentId === 'amzn')?.valuationChange).toBe('-29123.00')
    expect(calculateTotalValuationChange(results)).toBe('20477.00')
  })
})

function analyze(
  instrumentId: string,
  openingQuantity: string,
  openingValue: string,
  closingQuantity: string,
  closingValue: string,
  extras: {
    transactions?: Transaction[]
    corporateActions?: CorporateAction[]
  } = {},
) {
  const [result] = analyzePositionValuations({
    openingPositions: [holding(instrumentId, 'open', openingQuantity, openingValue)],
    closingPositions: [holding(instrumentId, 'close', closingQuantity, closingValue)],
    transactions: extras.transactions ?? [],
    corporateActions: extras.corporateActions ?? [],
    currency: 'ARS',
  })
  if (!result) throw new Error('faltó el resultado de la posición')
  return result
}

function holding(
  instrumentId: string,
  snapshotId: string,
  quantity: string,
  marketValue: string,
): Position {
  return {
    id: `${snapshotId}-${instrumentId}`,
    snapshotId,
    instrumentId,
    quantity,
    unitPrice: '1.00',
    marketValue,
    currency: 'ARS',
  }
}

function trade(type: TransactionType, instrumentId: string): Transaction {
  return {
    id: `${type}-${instrumentId}`,
    portfolioId: 'portfolio',
    periodId: 'august',
    instrumentId,
    date: '2026-08-10',
    type,
    quantity: '2',
    unitPrice: '1.00',
    grossAmount: '2.00',
    netAmount: '2.00',
    fees: null,
    taxes: null,
    currency: 'ARS',
    fxRate: null,
    sourceDocumentId: null,
    sourceReference: null,
    createdAt: '2026-08-10 00:00:00',
  }
}

function stockDividend(instrumentId: string): CorporateAction {
  return {
    id: `action-${instrumentId}`,
    portfolioId: 'portfolio',
    periodId: 'august',
    instrumentId,
    date: '2026-08-20',
    type: 'STOCK_DIVIDEND',
    quantityBefore: '14',
    quantityChange: '126',
    quantityAfter: '140',
    ratio: null,
    description: null,
    sourceDocumentId: null,
    createdAt: '2026-08-20 00:00:00',
  }
}
