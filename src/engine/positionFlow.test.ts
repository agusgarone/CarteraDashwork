import { describe, expect, it } from 'vitest'
import type { CorporateAction } from '../domain/corporateAction'
import type { Position } from '../domain/snapshot'
import type { Transaction, TransactionType } from '../domain/transaction'
import type { CashMovementLeg } from './calculations/cashLedger'
import {
  analyzePositionValueFlows,
  summarizePartialAttribution,
} from './calculations/positionValueFlow'
import { reconcilePositionQuantities } from './calculations/positionQuantity'
import { allocateTransactionCost, economicTradeCost } from './calculations/transactionCost'

describe('conciliación de cantidad', () => {
  it('deja igual una posición sin movimientos', () => {
    const [quantity] = reconcilePositionQuantities({
      openingPositions: [holding('aapl', 'open', '10', '100.00')],
      closingPositions: [holding('aapl', 'close', '10', '130.00')],
      transactions: [],
      corporateActions: [],
    })

    expect(quantity).toMatchObject({
      openingQuantity: '10',
      boughtQuantity: '0',
      soldQuantity: '0',
      expectedClosingQuantity: '10',
      actualClosingQuantity: '10',
      difference: '0',
      status: 'RECONCILED',
    })
  })

  it('suma una compra', () => {
    const [flow] = analyze([{ instrumentId: 'ypfd', openingQty: '12', openingValue: '1000.00', closingQty: '14', closingValue: '1400.00', trades: [buy('ypfd', '2', '200.00', 'ARS')] }])

    expect(flow.quantity).toMatchObject({
      boughtQuantity: '2',
      expectedClosingQuantity: '14',
      actualClosingQuantity: '14',
      status: 'RECONCILED',
    })
    expect(flow.periodPositionResult).toBe('200.00')
    expect(flow.valueStatus).toBe('VALUATION_EXPLAINED')
  })

  it('suma varias compras', () => {
    const [flow] = analyze([
      {
        instrumentId: 'spy',
        openingQty: '87',
        openingValue: '1000.00',
        closingQty: '216',
        closingValue: '5000.00',
        trades: [buy('spy', '54', '1072440.00', 'ARS'), buy('spy', '75', '1455750.00', 'ARS', '7321991')],
      },
    ])

    expect(flow.quantity).toMatchObject({
      openingQuantity: '87',
      boughtQuantity: '129',
      expectedClosingQuantity: '216',
      status: 'RECONCILED',
    })
    expect(flow.acquisitionFlows).toBe('2528190.00')
    expect(flow.periodPositionResult).toBe('-2524190.00')
  })

  it('mantiene una venta total aunque no haya fila de cierre', () => {
    const [flow] = analyze([
      {
        instrumentId: 'gd35',
        openingQty: '1098',
        openingValue: '1200000.00',
        closingQty: null,
        closingValue: null,
        trades: [sell('gd35', '-1098', '1377770.40', 'ARS')],
      },
    ])

    expect(flow.quantity).toMatchObject({
      soldQuantity: '1098',
      expectedClosingQuantity: '0',
      actualClosingQuantity: '0',
      status: 'RECONCILED',
    })
    expect(flow.valueStatus).toBe('CLOSED_DURING_PERIOD')
    expect(flow.closingValue).toBe('0.00')
    expect(flow.periodPositionResult).toBe('177770.40')
  })

  it('abre una posición que no estaba al inicio', () => {
    const [flow] = analyze([
      {
        instrumentId: 'smh',
        openingQty: null,
        openingValue: null,
        closingQty: '41',
        closingValue: '700000.00',
        trades: [buy('smh', '41', '694130.00', 'ARS')],
      },
    ])

    expect(flow.quantity).toMatchObject({
      openingQuantity: '0',
      boughtQuantity: '41',
      expectedClosingQuantity: '41',
      status: 'RECONCILED',
    })
    expect(flow.valueStatus).toBe('OPENED_DURING_PERIOD')
    expect(flow.periodPositionResult).toBe('5870.00')
  })

  it('resta la suscripción del fondo al resultado del período', () => {
    const [flow] = analyze([
      {
        instrumentId: 'bcacca',
        openingQty: '6596.326243',
        openingValue: '1000000.00',
        closingQty: '14860.792493',
        closingValue: '2500000.00',
        trades: [subscription('bcacca', '8264.466250', '1350000.00')],
      },
    ])

    expect(flow.quantity).toMatchObject({
      subscribedQuantity: '8264.466250',
      expectedClosingQuantity: '14860.792493',
      difference: '0',
      status: 'RECONCILED',
    })
    expect(flow.acquisitionFlows).toBe('1350000.00')
    expect(flow.periodPositionResult).toBe('150000.00')
    expect(flow.valueStatus).toBe('VALUATION_EXPLAINED')
  })

  it('no calcula el resultado de una compra en dólares contra una valuación en pesos', () => {
    const [flow] = analyze(
      [
        {
          instrumentId: 'ypfd',
          openingQty: '12',
          openingValue: '800000.00',
          closingQty: '14',
          closingValue: '900000.00',
          trades: [buy('ypfd', '2', '93.98', 'USD_MEP', '7321989')],
        },
      ],
      [
        leg('7321989', 'USD_MEP', '-94.45', { commission: '0.47' }),
        leg('7321989', 'ARS', '-231.47', { vat: '146.87', marketFees: '84.60', taxes: '14.68' }),
      ],
    )

    expect(flow.quantity.status).toBe('RECONCILED')
    expect(flow.valueStatus).toBe('MISSING_TRANSACTION_FX')
    expect(flow.periodPositionResult).toBeNull()
    expect(flow.reason).toBe('Pendiente: falta tipo de cambio de la operación.')
    expect(flow.costs).toEqual([
      expect.objectContaining({
        currency: 'USD_MEP',
        breakdown: expect.objectContaining({ commission: '0.47', total: '0.47' }),
      }),
      expect.objectContaining({
        currency: 'ARS',
        breakdown: expect.objectContaining({ vat: '146.87', marketFees: '84.60', total: '231.47' }),
      }),
    ])
  })

  it('marca la diferencia de cantidad sin inventar un resultado', () => {
    const [flow] = analyze([
      {
        instrumentId: 'aapl',
        openingQty: '10',
        openingValue: '100.00',
        closingQty: '12',
        closingValue: '140.00',
        trades: [],
      },
    ])

    expect(flow.quantity).toMatchObject({ difference: '2', status: 'QUANTITY_MISMATCH' })
    expect(flow.valueStatus).toBe('QUANTITY_MISMATCH')
    expect(flow.periodPositionResult).toBeNull()
  })

  it('separa el bruto del instrumento del neto de caja', () => {
    expect(economicTradeCost('BUY', '1072440.00', '-1079577.09')).toBe('7137.09')
    expect(
      allocateTransactionCost(
        { commission: '5362.20', vat: '1126.06', marketFees: '648.83', taxes: '112.61' },
        '7137.09',
      ),
    ).toEqual({
      commission: '5362.20',
      vat: '1126.06',
      marketFees: '648.83',
      taxes: '0.00',
      other: '0.00',
      total: '7137.09',
    })

    const [flow] = analyze(
      [
        {
          instrumentId: 'spy',
          openingQty: '87',
          openingValue: '1000.00',
          closingQty: '141',
          closingValue: '1100000.00',
          trades: [buy('spy', '54', '1072440.00', 'ARS', '7321990')],
        },
      ],
      [
        leg('7321990', 'ARS', '-1079577.09', {
          commission: '5362.20',
          vat: '1126.06',
          marketFees: '648.83',
          taxes: '112.61',
        }),
      ],
    )

    expect(flow.acquisitionFlows).toBe('1072440.00')
    expect(flow.periodPositionResult).toBe('26560.00')
    expect(flow.costs[0]?.breakdown).toMatchObject({
      commission: '5362.20',
      vat: '1126.06',
      marketFees: '648.83',
      taxes: '0.00',
      total: '7137.09',
    })
  })

  it('explica una parte y deja pendiente la compra en otra moneda', () => {
    const flows = analyze(
      [
        {
          instrumentId: 'aapl',
          openingQty: '10',
          openingValue: '1000.00',
          closingQty: '10',
          closingValue: '1100.00',
          trades: [],
        },
        {
          instrumentId: 'ypfd',
          openingQty: '12',
          openingValue: '800000.00',
          closingQty: '14',
          closingValue: '900000.00',
          trades: [buy('ypfd', '2', '93.98', 'USD_MEP', '7321989')],
        },
      ],
      [leg('7321989', 'ARS', '-231.47', { vat: '146.87', marketFees: '84.60' })],
      [income('DIVIDEND', '159.02', 'ARS'), income('DIVIDEND', '1.03', 'USD_CABLE')],
    )
    const partial = summarizePartialAttribution({
      flows,
      transactions: [income('DIVIDEND', '159.02', 'ARS'), income('DIVIDEND', '1.03', 'USD_CABLE')],
      baseCurrency: 'ARS',
      cashPerformancePending: true,
    })

    expect(partial.partialExplainedResult).toBe('27.55')
    expect(partial.pendingAttribution.cashPerformancePending).toBe(true)
    expect(partial.pendingAttribution.positions).toEqual([
      expect.objectContaining({ instrumentId: 'ypfd', status: 'MISSING_TRANSACTION_FX' }),
    ])
  })

  it('explica un dividendo en acciones solo con el cambio de valuación', () => {
    const [flow] = analyzePositionValueFlows({
      openingPositions: [holding('ypfd', 'open', '14', '49000.00')],
      closingPositions: [holding('ypfd', 'close', '140', '44100.00')],
      transactions: [],
      corporateActions: [stockDividend('ypfd', '126')],
      baseCurrency: 'ARS',
    })

    expect(flow.quantity.status).toBe('RECONCILED')
    expect(flow.valueStatus).toBe('CORPORATE_ACTION_EXPLAINED')
    expect(flow.periodPositionResult).toBe('-4900.00')
  })
})

function analyze(
  specs: {
    instrumentId: string
    openingQty: string | null
    openingValue: string | null
    closingQty: string | null
    closingValue: string | null
    trades: Transaction[]
  }[],
  legs: CashMovementLeg[] = [],
  extra: Transaction[] = [],
) {
  return analyzePositionValueFlows({
    openingPositions: specs
      .filter((spec) => spec.openingQty !== null && spec.openingValue !== null)
      .map((spec) => holding(spec.instrumentId, 'open', spec.openingQty ?? '0', spec.openingValue ?? '0')),
    closingPositions: specs
      .filter((spec) => spec.closingQty !== null && spec.closingValue !== null)
      .map((spec) => holding(spec.instrumentId, 'close', spec.closingQty ?? '0', spec.closingValue ?? '0')),
    transactions: [...specs.flatMap((spec) => spec.trades), ...extra],
    corporateActions: [],
    cashLegs: legs,
    baseCurrency: 'ARS',
  })
}

function holding(instrumentId: string, snapshotId: string, quantity: string, marketValue: string): Position {
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

function buy(
  instrumentId: string,
  quantity: string,
  gross: string,
  currency: Transaction['currency'],
  boleto = '1',
): Transaction {
  return movement('BUY', instrumentId, quantity, gross, currency, boleto)
}

function sell(instrumentId: string, quantity: string, gross: string, currency: Transaction['currency']): Transaction {
  return movement('SELL', instrumentId, quantity, gross, currency, '2')
}

function subscription(instrumentId: string, quantity: string, amount: string): Transaction {
  return movement('FUND_SUBSCRIPTION', instrumentId, quantity, amount, 'ARS', '3')
}

function movement(
  type: TransactionType,
  instrumentId: string,
  quantity: string,
  gross: string,
  currency: Transaction['currency'],
  boleto: string,
): Transaction {
  return {
    id: `${type}-${instrumentId}-${boleto}`,
    portfolioId: 'portfolio',
    periodId: 'july',
    instrumentId,
    date: '2026-07-10',
    type,
    quantity,
    unitPrice: '1.00',
    grossAmount: gross,
    netAmount: gross,
    fees: null,
    taxes: null,
    currency,
    fxRate: null,
    sourceDocumentId: null,
    sourceReference: `Boleto / ${boleto} /`,
    createdAt: '2026-07-10 00:00:00',
  }
}

function income(type: 'DIVIDEND' | 'INTEREST' | 'TAX' | 'FEE', net: string, currency: Transaction['currency']): Transaction {
  return {
    ...movement(type, 'cash', '0', net, currency, type),
    instrumentId: null,
    quantity: null,
    grossAmount: net,
    netAmount: net,
  }
}

function leg(
  operationId: string,
  currency: CashMovementLeg['currency'],
  amount: string,
  components: { commission?: string; vat?: string; marketFees?: string; taxes?: string },
): CashMovementLeg {
  return {
    operationId,
    operationType: 'BUY',
    currency,
    amount,
    date: '2026-07-10',
    role: 'TRADE_SETTLEMENT',
    commission: components.commission ?? null,
    vat: components.vat ?? null,
    marketFees: components.marketFees ?? null,
    taxComponent: components.taxes ?? null,
  }
}

function stockDividend(instrumentId: string, quantityChange: string): CorporateAction {
  return {
    id: `action-${instrumentId}`,
    portfolioId: 'portfolio',
    periodId: 'august',
    instrumentId,
    date: '2026-08-15',
    type: 'STOCK_DIVIDEND',
    quantityBefore: '14',
    quantityChange,
    quantityAfter: '140',
    ratio: null,
    description: null,
    sourceDocumentId: null,
    createdAt: '2026-08-15 00:00:00',
  }
}
