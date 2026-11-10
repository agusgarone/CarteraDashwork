import { expect, it } from 'vitest'
import { parseBalanzMonthlyFundStatementText } from './monthlyFundStatement'
import { parseBalanzConsolidatedPositionText } from './consolidatedPosition'

it('reconoce BALANZ CAPITAL como encabezado de fondo y conserva separados sus movimientos', () => {
  const parsed = parseBalanzMonthlyFundStatementText(`Fondo común de inversión
Informe del total de su inversión al: 31/08/2026
Lecaps | BALANZ LECAPS - Clase A ARS
Fecha | Concepto | Valor de Cuota | Cant. de Cuotas | Monto ($)
07/08/2026 | Suscripción | 2,077195 | 10,000000 | 20,77
Soberano | BALANZ CAPITAL RENTA FIJA en DOLARES - Clase A MEP
Fecha | Concepto | Valor de Cuota | Cant. de Cuotas | Monto (U$S)
18/08/2026 | Rescate | 1,400000 | (2,000000) | 2,80
`)
  expect(parsed.funds).toHaveLength(2)
  expect(parsed.funds[0]?.rows).toHaveLength(1)
  expect(parsed.funds[1]).toMatchObject({
    fundName: 'BALANZ CAPITAL RENTA FIJA en DOLARES',
    currency: 'USD_MEP',
    rows: [{ type: 'REDEMPTION', quantity: '-2.000000', amount: '2.80' }],
  })
})
it('conserva códigos FCI con mayúsculas y minúsculas sin extender la regla a acciones', () => {
  const statement = (category: string) => `Posición consolidada por concertación
Fecha resumen | 31/08/2026
Total | $ 10
${category} | $ 10
Pesos | $ 0,00
${category}
Especie | Descripción | Cantidad | Garantía | Precio | Valor Actual
BCRDolarA | Soberano Clase A | 10,00 | 0.00 | $ 1,00 | $ 10
`
  expect(
    parseBalanzConsolidatedPositionText(statement('Fondos')).positions[0],
  ).toMatchObject({
    ticker: 'BCRDolarA',
    name: 'Soberano Clase A',
    normalizedCategory: 'FUND',
    quantity: '10',
  })
  expect(
    parseBalanzConsolidatedPositionText(statement('Acciones')).positions,
  ).toEqual([])
})
