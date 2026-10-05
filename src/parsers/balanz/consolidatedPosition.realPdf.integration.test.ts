/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractPdfDocument } from '../text/extractPdfText'
import { parseBalanzConsolidatedPositionDocument, parseBalanzConsolidatedPositionText } from './consolidatedPosition'

const privateDirectory = fileURLToPath(new URL('./fixtures/private/', import.meta.url))

function privatePdf(token: string): string | null {
  if (!existsSync(privateDirectory)) return null
  const selected = readdirSync(privateDirectory).find(
    (name) => name.includes(token) && name.toLowerCase().endsWith('.pdf'),
  )
  return selected ? path.join(privateDirectory, selected) : null
}

function sanitized(name: string): string {
  return readFileSync(new URL(`./fixtures/public/${name}`, import.meta.url), 'utf8')
}

describe('PDF real de posición consolidada', () => {
  it('reproduce agosto', async (context) => {
    const pdfPath = privatePdf('20260831')
    if (!pdfPath) {
      context.skip('El PDF privado de posición consolidada de agosto no está en esta máquina.')
      return
    }

    const bytes = new Uint8Array(readFileSync(pdfPath))
    const document = await extractPdfDocument(bytes)
    const parsed = parseBalanzConsolidatedPositionDocument(document)
    const expected = parseBalanzConsolidatedPositionText(sanitized('consolidated-position-august2026-sanitized.txt'))

    expect(document.pageCount).toBe(5)
    expect(parsed).toEqual(expected)
  })

  it('reproduce julio', async (context) => {
    const pdfPath = privatePdf('20260731')
    if (!pdfPath) {
      context.skip('El PDF privado de posición consolidada de julio no está en esta máquina.')
      return
    }

    const bytes = new Uint8Array(readFileSync(pdfPath))
    const document = await extractPdfDocument(bytes)
    const parsed = parseBalanzConsolidatedPositionDocument(document)
    const expected = parseBalanzConsolidatedPositionText(sanitized('consolidated-position-july2026-sanitized.txt'))

    expect(document.pageCount).toBe(5)
    expect(parsed).toEqual(expected)
  })
})
