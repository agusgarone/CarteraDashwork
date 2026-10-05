/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractPdfDocument } from '../text/extractPdfText'
import { parseBalanzMonthlyFundStatementDocument, parseBalanzMonthlyFundStatementText } from './monthlyFundStatement'

const privateDirectory = fileURLToPath(new URL('./fixtures/private/', import.meta.url))
const sanitized = readFileSync(
  new URL('./fixtures/public/monthly-fund-statement-august2026-sanitized.txt', import.meta.url),
  'utf8',
)

function privateFundPdf(): string | null {
  if (!existsSync(privateDirectory)) return null
  const selected = readdirSync(privateDirectory).find(
    (name) => name.toLowerCase().startsWith('resumenfci') && name.toLowerCase().endsWith('.pdf'),
  )
  return selected ? path.join(privateDirectory, selected) : null
}

describe('PDF real de resumen cuotapartista', () => {
  it('reproduce el fixture sanitizado', async (context) => {
    const pdfPath = privateFundPdf()
    if (!pdfPath) {
      context.skip('El PDF privado del resumen cuotapartista no está en esta máquina.')
      return
    }

    const bytes = new Uint8Array(readFileSync(pdfPath))
    const document = await extractPdfDocument(bytes)
    const parsed = parseBalanzMonthlyFundStatementDocument(document)
    const expected = parseBalanzMonthlyFundStatementText(sanitized)

    expect(document.pageCount).toBe(1)
    expect(parsed).toEqual(expected)
  })
})
