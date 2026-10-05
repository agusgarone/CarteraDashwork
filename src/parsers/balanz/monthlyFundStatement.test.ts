/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ParserError } from '../errors/parserErrors'
import { parseBalanzMonthlyFundStatementText } from './monthlyFundStatement'

const august = readFileSync(
  new URL('./fixtures/public/monthly-fund-statement-august2026-sanitized.txt', import.meta.url),
  'utf8',
)

describe('resumen cuotapartista de agosto 2026', () => {
  const result = parseBalanzMonthlyFundStatementText(august)

  it('lee la fecha del informe y los dos fondos, sin códigos de la posición consolidada', () => {
    expect(result.reportDate).toBe('2026-08-31')
    expect(result.warnings).toEqual([])
    expect(result.funds).toHaveLength(2)
    expect(result.funds.map((fund) => fund.fundName)).toEqual(['BALANZ ACCIONES', 'BALANZ RETORNO TOTAL'])
    expect(JSON.stringify(result)).not.toContain('BCACCA')
    expect(JSON.stringify(result)).not.toContain('BRTA')
    expect(result.funds[0]).toMatchObject({
      categoryName: 'Acciones',
      fundName: 'BALANZ ACCIONES',
      shareClass: 'A',
      currency: 'ARS',
    })
    expect(result.funds[1]).toMatchObject({
      categoryName: 'Renta Mixta',
      fundName: 'BALANZ RETORNO TOTAL',
      shareClass: 'A',
      currency: 'ARS',
    })
  })

  it('conserva el saldo anterior y usa la fecha del encabezado en el total', () => {
    expect(result.funds[0]?.rows).toEqual([
      {
        type: 'PREVIOUS_BALANCE',
        date: '2026-07-31',
        unitValue: '167.933481',
        quantity: '14860.792493',
        amount: '2495624.61',
        sourceReference: 'BALANZ ACCIONES / Saldo Anterior',
      },
      {
        type: 'CURRENT_INVESTMENT',
        date: '2026-08-31',
        unitValue: '153.944160',
        quantity: '14860.792493',
        amount: '2287732.22',
        sourceReference: 'BALANZ ACCIONES / Total de inversión',
      },
    ])
    expect(result.funds[1]?.rows).toEqual([
      {
        type: 'PREVIOUS_BALANCE',
        date: '2026-07-31',
        unitValue: '746.673907',
        quantity: '3214.592773',
        amount: '2400252.55',
        sourceReference: 'BALANZ RETORNO TOTAL / Saldo Anterior',
      },
      {
        type: 'CURRENT_INVESTMENT',
        date: '2026-08-31',
        unitValue: '742.458542',
        quantity: '3214.592773',
        amount: '2386701.86',
        sourceReference: 'BALANZ RETORNO TOTAL / Total de inversión',
      },
    ])
    expect(result.funds.flatMap((fund) => fund.rows).some((row) => row.type === 'SUBSCRIPTION' || row.type === 'REDEMPTION')).toBe(false)
  })
})

describe('reglas de fecha del cuotapartista', () => {
  it('toma la fecha del total desde el encabezado, no desde un mes fijo', () => {
    const result = parseBalanzMonthlyFundStatementText(`FONDO COMÚN DE INVERSIÓN
Informe del total de su inversión al: 30/09/2026
Acciones | FONDO PRUEBA - Clase A | ARS
Fondo / Fecha | Concepto | Valor de Cuota | Cant. de Cuotas | Monto ($)
2026-08-31 | Saldo Anterior | 1,000000 | 2,000000 | 2,00
Total de inversión | | $ 3,000000 | 2,000000 | $ 6,00
`)

    expect(result.reportDate).toBe('2026-09-30')
    expect(result.funds[0]?.rows.map((row) => [row.type, row.date, row.amount])).toEqual([
      ['PREVIOUS_BALANCE', '2026-08-31', '2.00'],
      ['CURRENT_INVESTMENT', '2026-09-30', '6.00'],
    ])
  })

  it('no inventa la fecha del saldo anterior restando un mes', () => {
    const result = parseBalanzMonthlyFundStatementText(`FONDO COMÚN DE INVERSIÓN
Informe del total de su inversión al: 31/08/2026
Acciones | FONDO PRUEBA - Clase A | ARS
Fondo / Fecha | Concepto | Valor de Cuota | Cant. de Cuotas | Monto ($)
Saldo Anterior | | 1,00 | 2,00 | 2,00
`)

    expect(result.funds[0]?.rows).toEqual([])
    expect(result.warnings.map((item) => item.code)).toEqual(['MISSING_DATE'])
    expect(JSON.stringify(result)).not.toContain('2026-07-31')
  })

  it('rechaza un documento que no es el resumen de fondos', () => {
    expect(() => parseBalanzMonthlyFundStatementText('Posición consolidada por concertación')).toThrow(ParserError)
  })
})
