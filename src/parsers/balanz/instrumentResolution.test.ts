import { describe, expect, it } from 'vitest'
import { parseBalanzConsolidatedPositionText } from './consolidatedPosition'
import { parseBalanzMonthlyAccountText } from './monthlyAccount'
import { readExplicitOperationTicker, resolveOperationTicker } from './operationTicker'
import { readInstrumentHeader, readMovementTicker } from './statementTable'

const columns = 'Descripción | Cant. VN | Saldo | Precio | Bruto | Arancel Impor. | IVA Impor. | Derech Impor. | IVA | Neto | Fecha Co. | Fecha Li.'
const statement = (body: string) => `Cuenta Corriente por Concertación del 1/5/2026 al 31/5/2026\n${columns}\n${body}`
const trade = (description: string, qty: string, gross: string, net: string) => `${description} | ${qty} | | 1,00 | ${gross} | 0,02 | | | | ${net} | 19/5/2026 | 21/5/2026`

describe('identidad explícita de operaciones Balanz', () => {
  it('acepta C y AAPL únicamente en estructura de encabezado u operación', () => {
    expect(readInstrumentHeader('CEDEAR CITIGROUP - C /8046')).toBe('C')
    expect(readInstrumentHeader('CEDEAR APPLE - AAPL /8445')).toBe('AAPL')
    expect(readMovementTicker('Dividendo en efectivo / C')).toBe('C')
    expect(resolveOperationTicker({ description: 'a' })).toBeNull()
    expect(readInstrumentHeader('C')).toBeNull()
    expect(readExplicitOperationTicker('nota / A / usd')).toBeNull()
  })
  it('extrae C desde una fila de posición y no desde texto aislado', () => {
    const parsed = parseBalanzConsolidatedPositionText(`Posición consolidada por concertación
Fecha resumen | 31/03/2026
Total | $ 445.300
Cedears | $ 445.300
Pesos | $ 0,00
A
Cedears
Especie | Descripción | Cantidad | Garantía | Precio | Valor Actual
C | CEDEAR CITIGROUP | 8,00 | 0.00 | $ 55.650,00 | $ 445.200
AAPL | CEDEAR APPLE | 1,00 | 0.00 | $ 100,00 | $ 100
`)
    expect(parsed.positions.map(row => row.ticker)).toEqual(['C', 'AAPL'])
  })
  for (const [section, explicit] of [['AAPL', 'C'], ['KEEL', 'BITF']]) {
    it(`prioriza ${explicit} dentro de la sección ${section} y conserva el contexto`, () => {
      const description = `Boleto / 123 / VENTA / 1 / ${explicit} / $`
      const parsed = parseBalanzMonthlyAccountText(statement(`INSTRUMENTO - ${section} /10\n${trade(description, '-8,00', '8,00', '7,98')}`))
      expect(parsed.transactions[0]).toMatchObject({ ticker: explicit, type: 'SELL', quantity: '-8', sourceReference: description })
      expect(parsed.operationGroups[0]?.legs[0]).toMatchObject({ sectionTicker: section, explicitOperationTicker: explicit })
    })
  }
  it('usa la sección solo si la operación no tiene ticker explícito', () => {
    expect(resolveOperationTicker({ description: 'Dividendo en efectivo', sectionTicker: 'AAPL' })).toBe('AAPL')
  })
})

describe('adquisición en mercado primario', () => {
  const description = 'Boleto / 5549622 / Licitación MAE / 2 / TTCEO / usd'
  const body = (quantity: string, net: string) => `ON TECPETROL - TTCEO /59437\n${trade(description, quantity, '4,00', net)}\nDólares MEP - usd\n${trade(description, quantity, '-4,00', net)}`
  it('normaliza MAE como BUY con cantidad, fecha, moneda e importes del documento', () => {
    const parsed = parseBalanzMonthlyAccountText(statement(body('4,00', '-4,02')))
    expect(parsed.transactions).toHaveLength(1)
    expect(parsed.transactions[0]).toMatchObject({ ticker: 'TTCEO', type: 'BUY', quantity: '4', unitPrice: '1.00', grossAmount: '4.00', netAmount: '-4.02', currency: 'USD_MEP', date: '2026-05-19', sourceReference: description })
    expect(parsed.operationGroups[0]).toMatchObject({ operationReference: '5549622', operationType: 'BUY' })
  })
  it('no convierte en BUY una licitación con cantidad negativa o sin débito', () => {
    expect(parseBalanzMonthlyAccountText(statement(body('-4,00', '-4,02'))).transactions.some(row => row.type === 'BUY')).toBe(false)
    expect(parseBalanzMonthlyAccountText(statement(body('4,00', '4,02'))).transactions.some(row => row.type === 'BUY')).toBe(false)
  })
})