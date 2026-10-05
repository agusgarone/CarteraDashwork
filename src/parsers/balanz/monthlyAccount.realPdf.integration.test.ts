/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractPdfDocument } from '../text/extractPdfText'
import { parseBalanzMonthlyAccountDocument, parseBalanzMonthlyAccountText } from './monthlyAccount'

const privateDirectory = fileURLToPath(new URL('./fixtures/private/', import.meta.url))
const sanitizedAugust = readFileSync(
  new URL('./fixtures/public/august2026-sanitized.txt', import.meta.url),
  'utf8',
)

function privateAugustPdf(): string | null {
  if (!existsSync(privateDirectory)) return null
  const pdfs = readdirSync(privateDirectory).filter((name) => name.toLowerCase().endsWith('.pdf'))
  const august = pdfs.find((name) => /agosto/i.test(name))
  const selected = august ?? pdfs[0]
  return selected ? path.join(privateDirectory, selected) : null
}

describe('PDF real de agosto 2026', () => {
  const pdfPath = privateAugustPdf()

  it('reproduce el mismo resultado financiero que el fixture sanitizado', async (context) => {
    if (!pdfPath) {
      context.skip('El PDF privado de agosto 2026 no está en esta máquina.')
      return
    }

    const bytes = new Uint8Array(readFileSync(pdfPath))
    const document = await extractPdfDocument(bytes)
    const parsed = parseBalanzMonthlyAccountDocument(document)
    const sanitized = parseBalanzMonthlyAccountText(sanitizedAugust)

    expect(document.pageCount).toBe(4)
    expect(document.text.length).toBeGreaterThan(0)
    expect(parsed.period).toEqual(sanitized.period)
    expect(parsed.transactions).toEqual(sanitized.transactions)
    expect(parsed.corporateActions).toEqual(sanitized.corporateActions)
    expect(parsed.warnings).toEqual(sanitized.warnings)
    expect(parsed.transactions.some((item) => item.type === 'BUY' && item.ticker === 'YPFD')).toBe(false)
  })
})
