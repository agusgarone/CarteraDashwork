import { UnreadableDocumentError } from '../errors/parserErrors'

export interface PdfTextItem {
  text: string
  x: number
  width: number
}

/** Una fila visual. Conserva X e Y para reconstruir columnas por página. */
export interface PdfTextRow {
  page: number
  y: number
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
  const document = await openPdf(data)

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

async function openPdf(data: Uint8Array) {
  if (import.meta.env.MODE === 'test') {
    const runtime = await import('./pdfjsNode')
    return runtime.openPdf(data)
  }
  const runtime = await import('./pdfjsBrowser')
  return runtime.openPdf(data)
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
      y,
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
