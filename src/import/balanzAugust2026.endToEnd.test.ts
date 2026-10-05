/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBalanzConsolidatedPositionText } from '../parsers/balanz/consolidatedPosition'
import { parseBalanzMonthlyAccountText } from '../parsers/balanz/monthlyAccount'
import { parseBalanzMonthlyFundStatementText } from '../parsers/balanz/monthlyFundStatement'
import { analyzeParsedPeriod } from './analyzeParsedPeriod'
import {
  expectCashBalances,
  expectCashReconciliation,
  expectEngineResult,
  expectNoDoubleCounting,
  expectPrintedSnapshots,
  expectSignedMovements,
  expectSourceIdentity,
} from './julyAugustChecks'

const july = parseBalanzConsolidatedPositionText(readFixture('consolidated-position-july2026-sanitized.txt'))
const august = parseBalanzConsolidatedPositionText(readFixture('consolidated-position-august2026-sanitized.txt'))
const movements = parseBalanzMonthlyAccountText(readFixture('august2026-sanitized.txt'))
const fundStatement = parseBalanzMonthlyFundStatementText(readFixture('monthly-fund-statement-august2026-sanitized.txt'))
const analysis = analyzeParsedPeriod({
  portfolioId: 'portfolio:balanz',
  openingPeriodId: 'period:2026-07',
  closingPeriodId: 'period:2026-08',
  createdAt: '2026-10-04T00:00:00Z',
  opening: july,
  closing: august,
  movements,
  fundStatement,
})

describe('julio → agosto desde fixtures sanitizados', () => {
  it('toma los totales impresos y las tenencias del PDF', () => {
    expect(july.reportedTotal).toBe('25954029')
    expect(august.reportedTotal).toBe('26383988')
    expectPrintedSnapshots(analysis)
  })

  it('conserva el signo de los movimientos del resumen mensual', () => {
    expect(movements.warnings).toEqual([])
    expectSignedMovements(analysis)
  })

  it('mapea la caja impresa, con el cable de julio en cero', () => {
    expectCashBalances(analysis)
  })

  it('reconcilia el período con los valores impresos', () => {
    expectEngineResult(analysis)
  })

  it('cierra la cantidad de caja en las tres monedas', () => {
    expectCashReconciliation(analysis)
  })

  it('identifica el desfase de los documentos con la diferencia no explicada', () => {
    expectSourceIdentity(analysis)
  })

  it('no vuelve a sumar dividendos e impuestos sobre el resultado de caja', () => {
    expectNoDoubleCounting(analysis)
  })
})

function readFixture(name: string): string {
  return readFileSync(new URL(`../parsers/balanz/fixtures/public/${name}`, import.meta.url), 'utf8')
}
