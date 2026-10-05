/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBalanzConsolidatedPositionText } from './consolidatedPosition'

const august = readFileSync(
  new URL('./fixtures/public/consolidated-position-august2026-sanitized.txt', import.meta.url),
  'utf8',
)

const july = readFileSync(
  new URL('./fixtures/public/consolidated-position-july2026-sanitized.txt', import.meta.url),
  'utf8',
)

const HEADER = `Posición consolidada por concertación
Fecha resumen | 31/08/2026
Total | $ 100
`

describe('posición consolidada de agosto 2026', () => {
  const result = parseBalanzConsolidatedPositionText(august)

  it('lee la fecha, el total y las 25 tenencias impresas', () => {
    expect(result.snapshotDate).toBe('2026-08-31')
    expect(result.issuedAt).toBe('2026-10-04')
    expect(result.reportedTotal).toBe('26383988')
    expect(result.warnings).toEqual([])
    expect(result.positions).toHaveLength(25)
    expect(count(result, 'STOCK')).toBe(4)
    expect(count(result, 'CEDEAR')).toBe(17)
    expect(count(result, 'CORPORATE_BOND')).toBe(2)
    expect(count(result, 'FUND')).toBe(2)
    expect(result.positions.some((position) => position.ticker === 'YPFD' && position.normalizedCategory !== 'STOCK')).toBe(false)
  })

  it('toma cantidad y valor actual impresos, también en los fondos', () => {
    expect(position(result, 'META')).toMatchObject({ quantity: '13', marketValue: '496340', normalizedCategory: 'CEDEAR' })
    expect(position(result, 'AAPL')).toMatchObject({ quantity: '28', marketValue: '708960' })
    expect(position(result, 'AMZN')).toMatchObject({ quantity: '353', marketValue: '1021935' })
    expect(position(result, 'YPFD')).toMatchObject({
      quantity: '140',
      marketValue: '1155700',
      guarantee: '0.00',
      normalizedCategory: 'STOCK',
    })
    expect(position(result, 'PLC4O')).toMatchObject({ quantity: '4000', marketValue: '6840800', normalizedCategory: 'CORPORATE_BOND' })
    expect(position(result, 'BCACCA')).toMatchObject({
      quantity: '14860.79',
      unitPrice: '153.94',
      marketValue: '2287732',
      normalizedCategory: 'FUND',
    })
    expect(position(result, 'BRTA')).toMatchObject({
      quantity: '3214.59',
      unitPrice: '742.46',
      marketValue: '2386702',
    })
    expect(position(result, 'XLU')?.unitPrice).toBe('4507.50')
  })

  it('separa la caja reportada del valor en pesos calculado con el tipo de cambio', () => {
    expect(result.cashBalances).toEqual([
      {
        currency: 'ARS',
        amount: '267659.33',
        fxRate: null,
        reportedValueInBaseCurrency: '267659.33',
        calculatedValueInBaseCurrency: '267659.33',
      },
      {
        currency: 'USD_MEP',
        amount: '188.58',
        fxRate: '1534.51',
        reportedValueInBaseCurrency: null,
        calculatedValueInBaseCurrency: '289377.8958',
      },
      {
        currency: 'USD_CABLE',
        amount: '3.34',
        fxRate: '1600.56',
        reportedValueInBaseCurrency: null,
        calculatedValueInBaseCurrency: '5345.8704',
      },
    ])
  })

  it('reconcilia subtotales y deja visible la diferencia del total', () => {
    expect(result.categoryTotals.map((category) => [category.rawCategory, category.reportedTotal])).toEqual([
      ['Acciones', '2532860'],
      ['Cedears', '11767245'],
      ['Corporativos', '6847066'],
      ['Fondos', '4674434'],
    ])
    expect(result.reconciliation.categoryChecks.map((check) => check.difference)).toEqual(['0', '0', '0', '0'])
    expect(result.reconciliation).toMatchObject({
      positionsTotal: '25821605',
      cashCalculatedTotal: '562383.0962',
      calculatedPortfolioTotal: '26383988.0962',
      reportedPortfolioTotal: '26383988',
      difference: '0.0962',
    })
  })
})

describe('posición consolidada de julio 2026', () => {
  const result = parseBalanzConsolidatedPositionText(july)

  it('lee la fecha, el total y la misma cantidad de tenencias', () => {
    expect(result.snapshotDate).toBe('2026-07-31')
    expect(result.issuedAt).toBe('2026-09-20')
    expect(result.reportedTotal).toBe('25954029')
    expect(result.positions).toHaveLength(25)
    expect(count(result, 'STOCK')).toBe(4)
    expect(count(result, 'CEDEAR')).toBe(17)
    expect(count(result, 'CORPORATE_BOND')).toBe(2)
    expect(count(result, 'FUND')).toBe(2)
  })

  it('toma los instrumentos y los fondos tal como están impresos', () => {
    expect(position(result, 'META')).toMatchObject({ quantity: '13', marketValue: '475020' })
    expect(position(result, 'AAPL')).toMatchObject({ quantity: '28', marketValue: '680680' })
    expect(position(result, 'AMZN')).toMatchObject({ quantity: '353', marketValue: '1051058' })
    expect(position(result, 'YPFD')).toMatchObject({ quantity: '14', marketValue: '1160600', unitPrice: '82900.00' })
    expect(position(result, 'PLC4O')).toMatchObject({ quantity: '4000', marketValue: '6790400' })
    expect(position(result, 'BCACCA')).toMatchObject({
      quantity: '14860.79',
      unitPrice: '167.93',
      marketValue: '2495625',
    })
    expect(position(result, 'BRTA')).toMatchObject({
      quantity: '3214.59',
      unitPrice: '746.67',
      marketValue: '2400253',
    })
  })

  it('conserva el cable en cero porque el documento lo imprime', () => {
    expect(result.cashBalances).toEqual([
      {
        currency: 'ARS',
        amount: '17658.61',
        fxRate: null,
        reportedValueInBaseCurrency: '17658.61',
        calculatedValueInBaseCurrency: '17658.61',
      },
      {
        currency: 'USD_MEP',
        amount: '188.58',
        fxRate: '1518.19',
        reportedValueInBaseCurrency: null,
        calculatedValueInBaseCurrency: '286300.2702',
      },
      {
        currency: 'USD_CABLE',
        amount: '0.00',
        fxRate: '1579.25',
        reportedValueInBaseCurrency: null,
        calculatedValueInBaseCurrency: '0',
      },
    ])
  })

  it('marca el peso de diferencia del subtotal de fondos y no lo lleva a cero', () => {
    expect(result.categoryTotals.map((category) => [category.rawCategory, category.reportedTotal])).toEqual([
      ['Acciones', '2621270'],
      ['Cedears', '11336318'],
      ['Corporativos', '6796606'],
      ['Fondos', '4895877'],
    ])
    expect(result.reconciliation.categoryChecks.map((check) => check.difference)).toEqual(['0', '0', '0', '1'])
    expect(result.warnings.map((item) => item.code)).toEqual(['CATEGORY_TOTAL_MISMATCH'])
    expect(result.reconciliation).toMatchObject({
      positionsTotal: '25650072',
      cashCalculatedTotal: '303958.8802',
      calculatedPortfolioTotal: '25954030.8802',
      reportedPortfolioTotal: '25954029',
      difference: '1.8802',
    })
  })
})

describe('criterios del cuadro', () => {
  it('avisa si el subtotal no coincide con las tenencias', () => {
    const result = parseBalanzConsolidatedPositionText(`${HEADER}
Acciones | $ 11
Pesos | $ 0,00
Acciones
Especie | Descripción | Cantidad | Garantía | Precio | Valor Actual
GGAL | GALICIA | 1,00 | 0.00 | $ 10,00 | $ 10
`)

    expect(result.reconciliation.categoryChecks[0]?.difference).toBe('-1')
    expect(result.warnings.map((item) => item.code)).toContain('CATEGORY_TOTAL_MISMATCH')
  })

  it('no crea una tenencia sin cantidad o sin valor actual', () => {
    const result = parseBalanzConsolidatedPositionText(`${HEADER}
Acciones | $ 0
Pesos | $ 0,00
Acciones
Especie | Descripción | Cantidad | Garantía | Precio | Valor Actual
GGAL | GALICIA | | 0.00 | $ 10,00 | $ 10
PAMP | PAMPA | 2,00 | 0.00 | $ 5,00 |
`)

    expect(result.positions).toEqual([])
    expect(result.warnings.map((item) => item.code)).toEqual(['MISSING_QUANTITY', 'MISSING_MARKET_VALUE'])
  })

  it('avisa un instrumento repetido y una moneda desconocida', () => {
    const result = parseBalanzConsolidatedPositionText(`${HEADER}
Acciones | $ 20
Pesos | $ 0,00
Dólar Blue | USD 1,00
Acciones
Especie | Descripción | Cantidad | Garantía | Precio | Valor Actual
GGAL | GALICIA | 1,00 | 0.00 | $ 10,00 | $ 10
GGAL | GALICIA | 1,00 | 0.00 | $ 10,00 | $ 10
`)

    expect(result.warnings.map((item) => item.code)).toEqual(['UNKNOWN_CURRENCY', 'DUPLICATE_INSTRUMENT'])
    expect(result.cashBalances.map((balance) => balance.currency)).toEqual(['ARS'])
  })

  it('no usa la página de titulares ni la evolución como tenencias', () => {
    const result = parseBalanzConsolidatedPositionText(`${august}
Información de titulares y autorizados
Nombre | Relación
TITULAR EJEMPLO | Titular
`)

    expect(JSON.stringify(result)).not.toContain('TITULAR EJEMPLO')
    expect(result.positions).toHaveLength(25)
  })
})

function count(result: ReturnType<typeof parseBalanzConsolidatedPositionText>, category: string): number {
  return result.positions.filter((position) => position.normalizedCategory === category).length
}

function position(result: ReturnType<typeof parseBalanzConsolidatedPositionText>, ticker: string) {
  return result.positions.find((item) => item.ticker === ticker)
}
