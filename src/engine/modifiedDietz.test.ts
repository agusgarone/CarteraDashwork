import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { EntityId } from '../domain/common'
import type { Transaction, TransactionType } from '../domain/transaction'
import { calculateModifiedDietz } from './calculations/modifiedDietz'
import { daysBetween } from './calendarDate'
import { AnalysisError } from './errors/analysisErrors'

const Exact = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
const OPENING = '25954029'
const CLOSING_DATE = '2026-08-31'
const OPENING_DATE = '2026-07-31'
const RESULT = '179959.00'

describe('días civiles', () => {
  it('cuenta 31 días entre los snapshots de julio y agosto', () => {
    expect(daysBetween(OPENING_DATE, CLOSING_DATE)).toBe(31)
    expect(daysBetween('2026-08-03', CLOSING_DATE)).toBe(28)
    expect(daysBetween('2026-08-18', CLOSING_DATE)).toBe(13)
  })
})

describe('calculateModifiedDietz', () => {
  it('pondera el aporte y el retiro de agosto sin rehacer el resultado', () => {
    const result = calculateModifiedDietz({
      investmentResult: RESULT,
      openingValue: OPENING,
      openingDate: OPENING_DATE,
      closingDate: CLOSING_DATE,
      transactions: [
        movement('aporte', 'CONTRIBUTION', '1250000.00', '2026-08-03'),
        movement('retiro', 'WITHDRAWAL', '1000000.00', '2026-08-18'),
        movement('compra', 'BUY', '1072440.00', '2026-08-10'),
        movement('dividendo', 'DIVIDEND', '165.60', '2026-08-06'),
        movement('impuesto', 'TAX', '11.62', '2026-08-06'),
      ],
    })

    expect(result.status).toBe('CALCULATED')
    if (result.status !== 'CALCULATED') return
    expect(result.method).toBe('MODIFIED_DIETZ')
    expect(result.numerator).toBe(RESULT)
    expect(result.externalFlows.map((flow) => flow.transactionId)).toEqual(['aporte', 'retiro'])

    const weighted = new Exact(OPENING)
      .plus(new Exact('1250000').times(28).div(31))
      .minus(new Exact('1000000').times(13).div(31))
    expect(new Decimal(result.weightedCapital).toFixed(10)).toBe('26663706.4193548387')
    expect(result.weightedCapital).toBe(weighted.toFixed(28))
    expect(result.returnDecimal).toBe(new Exact(RESULT).div(weighted).toFixed(28))
    expect(result.returnDecimal.startsWith('0.006749211725')).toBe(true)
    expect(new Decimal(result.returnDecimal).times(100).toFixed(10)).toBe('0.6749211725')
    expect(result.returnDecimal).not.toBe('0.67')
    expect(result.weightedCapital).not.toBe('26663706.42')

    const [contribution, withdrawal] = result.externalFlows
    expect(contribution?.weight).toBe(new Exact(28).div(31).toFixed(28))
    expect(withdrawal?.weight).toBe(new Exact(13).div(31).toFixed(28))
    expect(contribution?.amount.startsWith('1250000')).toBe(true)
    expect(withdrawal?.amount.startsWith('-1000000')).toBe(true)
  })

  it('sin flujos se reduce a resultado sobre el valor de apertura', () => {
    const result = calculateModifiedDietz({
      investmentResult: '50.00',
      openingValue: '1000.00',
      openingDate: OPENING_DATE,
      closingDate: CLOSING_DATE,
      transactions: [movement('compra', 'BUY', '10.00', '2026-08-10')],
    })

    expect(result.status).toBe('CALCULATED')
    if (result.status !== 'CALCULATED') return
    expect(result.externalFlows).toEqual([])
    expect(new Decimal(result.weightedCapital).eq('1000')).toBe(true)
    expect(new Decimal(result.returnDecimal).eq('0.05')).toBe(true)
  })

  it('pondera un único aporte', () => {
    const result = august([movement('aporte', 'CONTRIBUTION', '310.00', '2026-08-10')])
    expect(result.status).toBe('CALCULATED')
    if (result.status !== 'CALCULATED') return
    const weighted = new Decimal('1000').plus(new Decimal('310').times(21).div(31))
    expect(new Decimal(result.weightedCapital).eq(weighted)).toBe(true)
    expect(result.externalFlows).toHaveLength(1)
    expect(result.externalFlows[0]?.amount.startsWith('-')).toBe(false)
  })

  it('resta un único retiro', () => {
    const result = august([movement('retiro', 'WITHDRAWAL', '310.00', '2026-08-10')])
    expect(result.status).toBe('CALCULATED')
    if (result.status !== 'CALCULATED') return
    const weighted = new Decimal('1000').minus(new Decimal('310').times(21).div(31))
    expect(new Decimal(result.weightedCapital).eq(weighted)).toBe(true)
    expect(result.externalFlows[0]?.amount.startsWith('-310')).toBe(true)
  })

  it('suma varios flujos con su propio peso', () => {
    const result = august([
      movement('a', 'CONTRIBUTION', '100.00', '2026-08-03'),
      movement('b', 'CONTRIBUTION', '50.00', '2026-08-18'),
      movement('c', 'WITHDRAWAL', '20.00', '2026-08-28'),
    ])
    expect(result.status).toBe('CALCULATED')
    if (result.status !== 'CALCULATED') return
    const weighted = new Exact('1000')
      .plus(new Exact(100).times(28).div(31))
      .plus(new Exact(50).times(13).div(31))
      .minus(new Exact(20).times(3).div(31))
    expect(result.externalFlows).toHaveLength(3)
    expect(result.weightedCapital).toBe(weighted.toFixed(28))
  })

  it('un flujo en la apertura pesa 1', () => {
    const result = august([movement('aporte', 'CONTRIBUTION', '125.00', OPENING_DATE)])
    expect(result.status).toBe('CALCULATED')
    if (result.status !== 'CALCULATED') return
    expect(new Decimal(result.externalFlows[0]?.weight ?? '0').eq(1)).toBe(true)
    expect(new Decimal(result.weightedCapital).eq('1125')).toBe(true)
  })

  it('un flujo en el cierre pesa 0', () => {
    const result = august([movement('aporte', 'CONTRIBUTION', '125.00', CLOSING_DATE)])
    expect(result.status).toBe('CALCULATED')
    if (result.status !== 'CALCULATED') return
    expect(new Decimal(result.externalFlows[0]?.weight ?? '1').eq(0)).toBe(true)
    expect(new Decimal(result.externalFlows[0]?.weightedAmount ?? '1').eq(0)).toBe(true)
    expect(new Decimal(result.weightedCapital).eq('1000')).toBe(true)
  })

  it('aporte y retiro del mismo día comparten el peso', () => {
    const result = august([
      movement('aporte', 'CONTRIBUTION', '80.00', '2026-08-18'),
      movement('retiro', 'WITHDRAWAL', '30.00', '2026-08-18'),
    ])
    expect(result.status).toBe('CALCULATED')
    if (result.status !== 'CALCULATED') return
    expect(result.externalFlows[0]?.weight).toBe(result.externalFlows[1]?.weight)
    const weighted = new Exact('1000').plus(new Exact(50).times(13).div(31))
    expect(result.weightedCapital).toBe(weighted.toFixed(28))
  })

  it('usa netAmount y no el bruto', () => {
    const flow = movement('aporte', 'CONTRIBUTION', '1000.00', '2026-08-03')
    flow.netAmount = '900.00'
    const result = august([flow])
    expect(result.status).toBe('CALCULATED')
    if (result.status !== 'CALCULATED') return
    expect(result.externalFlows[0]?.amount.startsWith('900')).toBe(true)
  })

  it('rechaza un flujo anterior a la apertura', () => {
    expect(() => august([movement('aporte', 'CONTRIBUTION', '10.00', '2026-07-30')])).toThrow(
      AnalysisError,
    )
    expect(() => august([movement('aporte', 'CONTRIBUTION', '10.00', '2026-07-30')])).toThrow(
      /fuera del período/,
    )
  })

  it('rechaza un flujo posterior al cierre', () => {
    expect(() => august([movement('retiro', 'WITHDRAWAL', '10.00', '2026-09-01')])).toThrow(
      /fuera del período/,
    )
  })

  it('rechaza una fecha que no es un día civil', () => {
    expect(() => august([movement('aporte', 'CONTRIBUTION', '10.00', '2026-08-03T10:00:00')])).toThrow(
      AnalysisError,
    )
  })

  it('no devuelve un ratio si el capital ponderado es cero', () => {
    const result = calculateModifiedDietz({
      investmentResult: '10.00',
      openingValue: '0.00',
      openingDate: OPENING_DATE,
      closingDate: CLOSING_DATE,
      transactions: [],
    })
    expect(result.status).toBe('INVALID_WEIGHTED_CAPITAL')
    expect(result.returnDecimal).toBeNull()
    expect(result.weightedCapital).not.toBe('Infinity')
  })

  it('no devuelve un ratio si el capital ponderado es negativo', () => {
    const result = august([movement('retiro', 'WITHDRAWAL', '2000.00', OPENING_DATE)], '100.00', '50.00')
    expect(result.status).toBe('INVALID_WEIGHTED_CAPITAL')
    if (result.status !== 'INVALID_WEIGHTED_CAPITAL') return
    expect(new Decimal(result.weightedCapital).eq('-1900')).toBe(true)
    expect(result.returnDecimal).toBeNull()
    expect(result.reason).toMatch(/no es positivo/)
  })
})

function august(
  transactions: Transaction[],
  openingValue = '1000.00',
  investmentResult = '50.00',
) {
  return calculateModifiedDietz({
    investmentResult,
    openingValue,
    openingDate: OPENING_DATE,
    closingDate: CLOSING_DATE,
    transactions,
  })
}

function movement(
  id: EntityId,
  type: TransactionType,
  amount: string,
  date: string,
): Transaction {
  return {
    id,
    portfolioId: 'portfolio',
    periodId: 'august',
    instrumentId: null,
    date,
    type,
    quantity: null,
    unitPrice: null,
    grossAmount: amount,
    netAmount: amount,
    fees: null,
    taxes: null,
    currency: 'ARS',
    fxRate: null,
    sourceDocumentId: null,
    sourceReference: null,
    createdAt: `${date} 00:00:00`,
  }
}
