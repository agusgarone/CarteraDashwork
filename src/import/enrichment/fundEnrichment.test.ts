/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CurrencyCode } from '../../domain/currency'
import { parseBalanzConsolidatedPositionText } from '../../parsers/balanz/consolidatedPosition'
import { parseBalanzMonthlyFundStatementText } from '../../parsers/balanz/monthlyFundStatement'
import type { ParsedConsolidatedPosition, ParsedPosition } from '../../parsers/models/parsedConsolidatedPosition'
import type { ParsedFundStatement, ParsedMonthlyFundStatement } from '../../parsers/models/parsedMonthlyFundStatement'
import { fundMatchKey, fundMatchKeyFromConsolidatedName, fundMatchKeyFromStatement } from '../fundIdentity'
import { enrichFundPositions } from './enrichFundPositions'

const july = parseBalanzConsolidatedPositionText(
  readFileSync(new URL('../../parsers/balanz/fixtures/public/consolidated-position-july2026-sanitized.txt', import.meta.url), 'utf8'),
)
const august = parseBalanzConsolidatedPositionText(
  readFileSync(new URL('../../parsers/balanz/fixtures/public/consolidated-position-august2026-sanitized.txt', import.meta.url), 'utf8'),
)
const funds = parseBalanzMonthlyFundStatementText(
  readFileSync(new URL('../../parsers/balanz/fixtures/public/monthly-fund-statement-august2026-sanitized.txt', import.meta.url), 'utf8'),
)

describe('identidad de fondos', () => {
  it('cruza categoría, clase y moneda, sin ticker', () => {
    const statement = funds.funds[0]
    if (!statement) throw new Error('Falta el fondo de acciones')

    expect(fundMatchKeyFromConsolidatedName('Acciones Clase A', 'ARS')).toBe('acciones|A|ARS')
    expect(fundMatchKeyFromStatement(statement)).toBe('acciones|A|ARS')
    expect(fundMatchKeyFromConsolidatedName('Renta Mixta Clase A', 'ARS')).toBe('renta-mixta|A|ARS')
    expect(fundMatchKey('Renta Míxta', 'clase a', 'ARS')).toBe('renta-mixta|A|ARS')
    expect(fundMatchKeyFromConsolidatedName('Acciones Clase A', 'ARS')).not.toContain('BCACCA')
    expect(fundMatchKeyFromConsolidatedName('Acciones Especiales Clase A', 'ARS')).toBe('acciones-especiales|A|ARS')
    expect(fundMatchKeyFromConsolidatedName('Acciones Clase B', 'ARS')).toBe('acciones|B|ARS')
  })
})

describe('enriquecimiento de los FCI', () => {
  it('reemplaza julio con el saldo anterior y agosto con el total', () => {
    const opening = enrichFundPositions({
      consolidatedPosition: july,
      fundStatement: funds,
      snapshotDate: july.snapshotDate,
      holdingCurrency: 'ARS',
    })
    const closing = enrichFundPositions({
      consolidatedPosition: august,
      fundStatement: funds,
      snapshotDate: august.snapshotDate,
      holdingCurrency: 'ARS',
    })

    expect(opening.warnings).toEqual([])
    expect(closing.warnings).toEqual([])
    expect(fund(opening.position, 'Acciones Clase A')).toMatchObject({
      ticker: fund(july, 'Acciones Clase A')?.ticker,
      quantity: '14860.792493',
      unitPrice: '167.933481',
      marketValue: '2495624.61',
    })
    expect(fund(opening.position, 'Renta Mixta Clase A')).toMatchObject({
      quantity: '3214.592773',
      unitPrice: '746.673907',
      marketValue: '2400252.55',
    })
    expect(fund(closing.position, 'Acciones Clase A')).toMatchObject({
      quantity: '14860.792493',
      unitPrice: '153.944160',
      marketValue: '2287732.22',
    })
    expect(fund(closing.position, 'Renta Mixta Clase A')).toMatchObject({
      quantity: '3214.592773',
      unitPrice: '742.458542',
      marketValue: '2386701.86',
    })
    expect(july.positions.find((position) => position.name === 'Acciones Clase A')?.marketValue).toBe('2495625')
    expect(opening.position.reportedTotal).toBe('25954029')
    expect(closing.position.reportedTotal).toBe('26383988')
    expect(opening.position.reconciliation).toBe(july.reconciliation)
    expect(closing.position.reconciliation).toBe(august.reconciliation)
    expect(opening.position.reconciliation.difference).toBe('1.8802')
    expect(closing.position.reconciliation.difference).toBe('0.0962')
    expect(opening.enrichedDetail).toMatchObject({
      positionsTotal: '25650071.16',
      cashCalculatedTotal: '303958.8802',
      calculatedTotal: '25954030.0402',
      reportedTotal: '25954029.00',
      difference: '1.0402',
    })
    expect(closing.enrichedDetail).toMatchObject({
      positionsTotal: '25821605.08',
      cashCalculatedTotal: '562383.0962',
      calculatedTotal: '26383988.1762',
      reportedTotal: '26383988.00',
      difference: '0.1762',
    })
    expect(opening.audits.find((item) => item.positionIdentity === 'acciones|A|ARS')?.marketValueSource).toEqual({
      documentType: 'MONTHLY_FUND_STATEMENT',
      sourceReference: 'BALANZ ACCIONES / Saldo Anterior',
      asOfDate: '2026-07-31',
    })
    expect(closing.audits.find((item) => item.positionIdentity === 'renta-mixta|A|ARS')?.quantitySource.documentType).toBe(
      'MONTHLY_FUND_STATEMENT',
    )
    const stock = opening.audits.find((item) => item.marketValueSource.documentType === 'CONSOLIDATED_POSITION')
    expect(stock?.quantitySource.documentType).toBe('CONSOLIDATED_POSITION')
    expect(fund(opening.position, 'YPFD')?.marketValue).toBe(fund(july, 'YPFD')?.marketValue)
  })
})

describe('cuando el fondo no se puede cruzar', () => {
  it('no matchea otra clase ni otra moneda', () => {
    const otherClass = enrichFundPositions({
      consolidatedPosition: position('Acciones Clase B', '10', '10'),
      fundStatement: funds,
      snapshotDate: '2026-08-31',
      holdingCurrency: 'ARS',
    })
    const otherCurrency = enrichFundPositions({
      consolidatedPosition: position('Acciones Clase A', '10', '10'),
      fundStatement: statementWithCurrency('USD_MEP'),
      snapshotDate: '2026-08-31',
      holdingCurrency: 'ARS',
    })

    expect(otherClass.warnings.map((item) => item.code)).toEqual(['NO_MATCH'])
    expect(otherClass.position.positions[0]?.marketValue).toBe('10')
    expect(otherCurrency.warnings.map((item) => item.code)).toEqual(['CURRENCY_MISMATCH'])
    expect(otherCurrency.position.positions[0]?.marketValue).toBe('10')
  })

  it('avisa un fondo duplicado o desconocido y conserva la posición consolidada', () => {
    const duplicated = enrichFundPositions({
      consolidatedPosition: position('Acciones Clase A', '10', '10'),
      fundStatement: {
        ...funds,
        funds: [funds.funds[0], funds.funds[0]].filter((fund): fund is ParsedFundStatement => fund !== undefined),
      },
      snapshotDate: '2026-08-31',
      holdingCurrency: 'ARS',
    })
    const unknown = enrichFundPositions({
      consolidatedPosition: position('Bonos Clase C', '10', '10'),
      fundStatement: funds,
      snapshotDate: '2026-08-31',
      holdingCurrency: 'ARS',
    })
    const missingAmount = enrichFundPositions({
      consolidatedPosition: position('Acciones Clase A', '10', '10'),
      fundStatement: statementWithAmount(null),
      snapshotDate: '2026-08-31',
      holdingCurrency: 'ARS',
    })

    expect(duplicated.warnings.map((item) => item.code)).toEqual(['DUPLICATE_MATCH'])
    expect(duplicated.position.positions[0]?.quantity).toBe('10')
    expect(unknown.warnings.map((item) => item.code)).toEqual(['NO_MATCH'])
    expect(unknown.position.positions[0]?.marketValue).toBe('10')
    expect(missingAmount.warnings.map((item) => item.code)).toEqual(['MISSING_AMOUNT'])
    expect(missingAmount.position.positions[0]?.unitPrice).toBe('1')

    const missingDate = enrichFundPositions({
      consolidatedPosition: position('Acciones Clase A', '10', '10'),
      fundStatement: funds,
      snapshotDate: '2026-06-30',
      holdingCurrency: 'ARS',
    })
    expect(missingDate.warnings.map((item) => item.code)).toEqual(['MISSING_DATE'])
    expect(missingDate.position.positions[0]?.marketValue).toBe('10')
  })
})

function fund(position: ParsedConsolidatedPosition, name: string): ParsedPosition | undefined {
  return position.positions.find((item) => item.name === name || item.ticker === name)
}

function position(name: string, quantity: string, marketValue: string): ParsedConsolidatedPosition {
  return {
    ...july,
    positions: [
      {
        ticker: 'FONDO',
        name,
        rawCategory: 'Fondos',
        normalizedCategory: 'FUND',
        quantity,
        guarantee: null,
        unitPrice: '1',
        marketValue,
        sourceReference: name,
      },
    ],
  }
}

function statementWithCurrency(currency: CurrencyCode): ParsedMonthlyFundStatement {
  return {
    ...funds,
    funds: funds.funds.map((fund) => ({ ...fund, currency })),
  }
}

function statementWithAmount(amount: string | null): ParsedMonthlyFundStatement {
  const fund = funds.funds[0]
  if (!fund) throw new Error('Falta el fondo de acciones')
  return {
    ...funds,
    funds: [
      {
        ...fund,
        rows: fund.rows.map((row) => (row.date === '2026-08-31' ? { ...row, amount } : row)),
      },
    ],
  }
}
