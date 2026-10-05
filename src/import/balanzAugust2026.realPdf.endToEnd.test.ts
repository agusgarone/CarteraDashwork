/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { parseBalanzConsolidatedPositionDocument } from '../parsers/balanz/consolidatedPosition'
import { parseBalanzMonthlyAccountDocument } from '../parsers/balanz/monthlyAccount'
import { parseBalanzMonthlyFundStatementDocument } from '../parsers/balanz/monthlyFundStatement'
import { extractPdfDocument } from '../parsers/text/extractPdfText'
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

const privateDirectory = fileURLToPath(new URL('../parsers/balanz/fixtures/private/', import.meta.url))

describe('PDF real julio → agosto', () => {
  it('recorre parsers, adapters y motor', async (context) => {
    const julyPath = privatePdf('20260731')
    const augustPath = privatePdf('20260831')
    const monthlyPath = privateMonthlyPdf()
    const fundPath = privateFundPdf()
    if (!julyPath || !augustPath || !monthlyPath || !fundPath) {
      context.skip('Falta un PDF privado de Balanz en esta máquina.')
      return
    }

    const [julyDocument, augustDocument, monthlyDocument, fundDocument] = await Promise.all([
      extractPdfDocument(await readPdf(julyPath)),
      extractPdfDocument(await readPdf(augustPath)),
      extractPdfDocument(await readPdf(monthlyPath)),
      extractPdfDocument(await readPdf(fundPath)),
    ])
    const analysis = analyzeParsedPeriod({
      portfolioId: 'portfolio:balanz',
      openingPeriodId: 'period:2026-07',
      closingPeriodId: 'period:2026-08',
      createdAt: '2026-10-04T00:00:00Z',
      opening: parseBalanzConsolidatedPositionDocument(julyDocument),
      closing: parseBalanzConsolidatedPositionDocument(augustDocument),
      movements: parseBalanzMonthlyAccountDocument(monthlyDocument),
      fundStatement: parseBalanzMonthlyFundStatementDocument(fundDocument),
    })

    expectPrintedSnapshots(analysis)
    expectSignedMovements(analysis)
    expectCashBalances(analysis)
    expectEngineResult(analysis)
    expectCashReconciliation(analysis)
    expectSourceIdentity(analysis)
    expectNoDoubleCounting(analysis)
  })
})

function privatePdf(token: string): string | null {
  if (!existsSync(privateDirectory)) return null
  const selected = readdirSync(privateDirectory).find(
    (name) => name.includes(token) && name.toLowerCase().endsWith('.pdf'),
  )
  return selected ? path.join(privateDirectory, selected) : null
}

function privateFundPdf(): string | null {
  if (!existsSync(privateDirectory)) return null
  const selected = readdirSync(privateDirectory).find(
    (name) => name.toLowerCase().startsWith('resumenfci') && name.toLowerCase().endsWith('.pdf'),
  )
  return selected ? path.join(privateDirectory, selected) : null
}
function privateMonthlyPdf(): string | null {
  if (!existsSync(privateDirectory)) return null
  const selected = readdirSync(privateDirectory).find(
    (name) => /estadodecuenta/i.test(name) && /agosto/i.test(name) && name.toLowerCase().endsWith('.pdf'),
  )
  return selected ? path.join(privateDirectory, selected) : null
}

async function readPdf(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(readFileSync(filePath))
}
