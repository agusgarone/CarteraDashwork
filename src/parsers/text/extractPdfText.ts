/// <reference types="node" />

import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { UnreadableDocumentError } from '../errors/parserErrors'

export interface PdfTextItem {
  text: string
  x: number
  width: number
}

/** Una fila visual. Conserva la posición horizontal para no mezclar columnas. */
export interface PdfTextRow {
  page: number
  items: PdfTextItem[]
}

export interface PdfTextDocument {
  pageCount: number
  rows: PdfTextRow[]
  text: string
}

/**
 * Extrae el texto de un PDF y conserva las columnas.
 * Las reglas de Balanz no viven acá: si cambia la librería, el parser no cambia.
 */
export async function extractPdfDocument(data: Uint8Array): Promise<PdfTextDocument> {
  const document = await getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
  }).promise

  const rows: PdfTextRow[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    rows.push(...itemsToRows(pageNumber, content.items))
  }

  const text = rows
    .map((row) => row.items.map((item) => item.text).join(' '))
    .filter((line) => line.length > 0)
    .join('\n')
    .trim()
  if (text.length === 0) {
    throw new UnreadableDocumentError()
  }
  return { pageCount: document.numPages, rows, text }
}

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const document = await extractPdfDocument(data)
  return document.text
}

function pdfjsAssetUrl(folder: string): string {
  const require = createRequire(import.meta.url)
  const packageJson = require.resolve('pdfjs-dist/package.json')
  const folderPath = path.join(path.dirname(packageJson), folder)
  const href = pathToFileURL(folderPath).href
  return href.endsWith('/') ? href : `${href}/`
}

function itemsToRows(page: number, items: readonly unknown[]): PdfTextRow[] {
  const grouped = new Map<number, PdfTextItem[]>()
  for (const item of items) {
    if (!isTextItem(item) || item.str.trim().length === 0) continue
    const y = Math.round(item.transform[5] ?? 0)
    const row = grouped.get(y) ?? []
    row.push({
      text: item.str.trim(),
      x: item.transform[4] ?? 0,
      width: item.width ?? 0,
    })
    grouped.set(y, row)
  }

  return [...grouped.keys()]
    .sort((left, right) => right - left)
    .map((y) => ({
      page,
      items: (grouped.get(y) ?? []).sort((left, right) => left.x - right.x),
    }))
    .filter((row) => row.items.length > 0)
}

function isTextItem(item: unknown): item is { str: string; transform: number[]; width?: number } {
  if (typeof item !== 'object' || item === null) return false
  if (!('str' in item) || typeof item.str !== 'string') return false
  if (!('transform' in item) || !Array.isArray(item.transform)) return false
  return true
}
