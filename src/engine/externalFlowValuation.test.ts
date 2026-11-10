import { describe, expect, it } from 'vitest'
import type { Transaction } from '../domain/transaction'
import type { StoredTransactionFx } from '../repositories/transactionFxRepository'
import {
  valueExternalFlows,
  PendingExternalFlowFxError,
} from './calculations/externalFlowValuation'
import { aggregateExternalFlows } from './calculations/externalFlows'
import { calculateModifiedDietz } from './calculations/modifiedDietz'
import { createPeriodAnalysisService } from './services/periodAnalysisService'

function movement(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'flow',
    portfolioId: 'portfolio',
    periodId: 'march',
    instrumentId: null,
    date: '2026-03-26',
    type: 'WITHDRAWAL',
    quantity: null,
    unitPrice: null,
    grossAmount: '998.71',
    netAmount: '998.71',
    fees: null,
    taxes: null,
    currency: 'USD_MEP',
    fxRate: null,
    sourceDocumentId: 'document',
    sourceReference: 'Comprobante de Pago / referencia-prueba',
    createdAt: '',
    ...overrides,
  }
}
function service(
  transactions: Transaction[],
  fxRows: StoredTransactionFx[] = [],
) {
  const snapshot = {
    id: 'close',
    portfolioId: 'portfolio',
    periodId: 'march',
    date: '2026-03-31',
    totalValue: '1000000',
    currency: 'ARS' as const,
    sourceDocumentId: 'document',
    createdAt: '',
  }
  return createPeriodAnalysisService({
    periods: {
      getById: async () => ({
        id: 'march',
        portfolioId: 'portfolio',
        year: 2026,
        month: 3,
        status: 'COMPLETE',
        completedAt: '',
        createdAt: '',
      }),
    },
    snapshots: {
      getLatestByPeriod: async () => snapshot,
      getLatestBefore: async () => ({
        ...snapshot,
        id: 'open',
        date: '2026-02-28',
        totalValue: '2000000',
      }),
    },
    transactions: { getByPeriod: async () => transactions },
    fxEnrichments: { getByPeriod: async () => fxRows },
  })
}
describe('valuación documental de flujos externos', () => {
  it.each(['WITHDRAWAL', 'CONTRIBUTION'] as const)(
    'preserva %s en ARS',
    async (type) => {
      const row = movement({ type, currency: 'ARS' })
      const result = await service([row]).analyzePeriod('march')
      expect(result).toMatchObject(
        type === 'WITHDRAWAL'
          ? {
              withdrawals: '998.71',
              contributions: '0.00',
              investmentResult: '-999001.29',
            }
          : {
              withdrawals: '0.00',
              contributions: '998.71',
              investmentResult: '-1000998.71',
            },
      )
      expect(result.externalFlowValuations).toBeUndefined()
    },
  )
  it.each(['WITHDRAWAL', 'CONTRIBUTION'] as const)(
    'valúa %s USD MEP con el FX de su documento sin alterar el nominal',
    async (type) => {
      const row = movement({ type, fxRate: '1500.125' })
      const original = structuredClone(row)
      const valued = valueExternalFlows([row], 'ARS')
      expect(valued.status).toBe('VALUED')
      if (valued.status !== 'VALUED') throw new Error('Falta valuación')
      expect(valued.valuations[0]).toMatchObject({
        amount: '998.71',
        amountBase: '1498189.83875',
        fxRate: '1500.125',
        fxKind: 'TRANSACTION',
        provenance: { sourceDocumentId: 'document' },
      })
      expect(aggregateExternalFlows([row], valued.valuations)).toMatchObject(
        type === 'WITHDRAWAL'
          ? { withdrawals: '1498189.84' }
          : { contributions: '1498189.84' },
      )
      const result = await service([row]).analyzePeriod('march')
      expect(result.investmentResult).toBe(
        type === 'WITHDRAWAL' ? '498189.84' : '-2498189.84',
      )
      expect(row).toEqual(original)
    },
  )
  it('expone los datos del flujo pendiente y evita resultados financieros', async () => {
    const row = movement()
    const state = valueExternalFlows([row], 'ARS')
    expect(state).toMatchObject({
      status: 'PENDING_EXTERNAL_FLOW_FX',
      flows: [
        {
          amount: '998.71',
          currency: 'USD_MEP',
          date: '2026-03-26',
          type: 'WITHDRAWAL',
          reason: 'MISSING_FX',
        },
      ],
    })
    await expect(service([row]).analyzePeriod('march')).rejects.toBeInstanceOf(
      PendingExternalFlowFxError,
    )
  })
  it.each(['0', '-1', 'NaN', 'Infinity', 'texto'])(
    'rechaza FX inválido %s como valuación',
    (fxRate) => {
      expect(valueExternalFlows([movement({ fxRate })], 'ARS')).toMatchObject({
        status: 'PENDING_EXTERNAL_FLOW_FX',
        flows: [{ reason: 'INVALID_FX' }],
      })
    },
  )
  it('Dietz pondera el importe base con la fecha real del retiro', () => {
    const row = movement({ netAmount: '10', fxRate: '1000' })
    const result = calculateModifiedDietz({
      baseCurrency: 'ARS',
      investmentResult: '100',
      openingValue: '100000',
      openingDate: '2026-03-01',
      closingDate: '2026-03-31',
      transactions: [row],
    })
    expect(result.externalFlows[0]).toMatchObject({
      date: '2026-03-26',
      amount: '-10000.0000000000000000000000000000',
    })
    expect(result.externalFlows[0]!.weight).toBe(
      '0.1666666666666666666666666667',
    )
    expect(result.weightedCapital).toBe('98333.3333333333333333333333333333')
    expect(() =>
      calculateModifiedDietz({
        baseCurrency: 'ARS',
        investmentResult: '100',
        openingValue: '100000',
        openingDate: '2026-03-01',
        closingDate: '2026-03-31',
        transactions: [movement()],
      }),
    ).toThrow(PendingExternalFlowFxError)
  })
  it('reutiliza el enrichment con fecha, moneda y provenance del mismo movimiento', async () => {
    const row = movement()
    const fx: StoredTransactionFx = {
      transactionId: row.id,
      fxRate: '1500',
      fxKind: 'MEP',
      fxDate: row.date,
      sourceDocumentId: 'fx-document',
      sourceSheet: 'source',
      sourceRow: 2,
      sourceColumn: 'FX',
      operationReference: row.sourceReference,
    }
    const result = await service([row], [fx]).analyzePeriod('march')
    expect(result.externalFlowValuations?.[0]).toMatchObject({
      amountBase: '1498065',
      provenance: { sourceDocumentId: 'fx-document', enrichment: fx },
    })
    expect(
      valueExternalFlows([row], 'ARS', [{ ...fx, fxKind: 'CCL' }]),
    ).toMatchObject({ status: 'PENDING_EXTERNAL_FLOW_FX' })
    expect(
      valueExternalFlows([row], 'ARS', [{ ...fx, fxDate: '2026-03-31' }]),
    ).toMatchObject({ status: 'PENDING_EXTERNAL_FLOW_FX' })
  })
  it('admite USD CABLE con FX documental y conserva el bucket', async () => {
    const row = movement({ currency: 'USD_CABLE', fxRate: '1600' })
    expect((await service([row]).analyzePeriod('march')).withdrawals).toBe(
      '1597936.00',
    )
    expect(row.currency).toBe('USD_CABLE')
  })
})

it('mantiene precisión decimal superior a Number en la valuación nominal', () => {
  const result = valueExternalFlows(
    [movement({ netAmount: '9007199254740993.01', fxRate: '1.000001' })],
    'ARS',
  )
  expect(result.status).toBe('VALUED')
  if (result.status !== 'VALUED') throw new Error('Falta valuación')
  expect(result.valuations[0]!.amountBase).toBe('9007208261940247.75099301')
})
it('un FX sin documento fuente queda pendiente por provenance', () => {
  expect(
    valueExternalFlows(
      [movement({ fxRate: '1500', sourceDocumentId: null })],
      'ARS',
    ),
  ).toMatchObject({
    status: 'PENDING_EXTERNAL_FLOW_FX',
    flows: [{ reason: 'MISSING_PROVENANCE' }],
  })
})

it('Dietz rechaza flujos extranjeros sin valuación aunque reciba una lista vacía', () => {
  expect(() =>
    calculateModifiedDietz({
      baseCurrency: 'ARS',
      externalFlowValuations: [],
      investmentResult: '100',
      openingValue: '100000',
      openingDate: '2026-03-01',
      closingDate: '2026-03-31',
      transactions: [movement()],
    }),
  ).toThrow(PendingExternalFlowFxError)
})
