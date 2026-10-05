import type { CurrencyCode } from '../../domain/currency'
import type { PdfTextDocument, PdfTextRow } from '../text/extractPdfText'

export type StatementColumn =
  | 'description'
  | 'quantity'
  | 'balance'
  | 'price'
  | 'gross'
  | 'fee'
  | 'vatCharge'
  | 'rights'
  | 'vat'
  | 'net'
  | 'tradeDate'
  | 'settlementDate'
  | 'fxRate'

export interface StatementLine {
  description: string
  cells: Partial<Record<StatementColumn, string>>
}

/**
 * Arma filas de la cuenta corriente.
 * El PDF real trae cada operación en una sola fila visual, con el saldo
 * corrido en una columna distinta del Neto.
 */
export function statementLinesFromPdf(document: PdfTextDocument): StatementLine[] {
  const lines: StatementLine[] = []
  let columns: { key: StatementColumn; x: number }[] | null = null

  for (const row of document.rows) {
    const header = headerFromItems(row)
    if (header) {
      columns = header
      continue
    }
    if (!columns) {
      const description = row.items.map((item) => item.text).join(' ').trim()
      if (description.length > 0) lines.push({ description, cells: { description } })
      continue
    }
    lines.push(lineFromPositionedRow(row, columns))
  }

  return lines
}

/** Lee el mismo cuadro cuando el fixture ya separó las columnas con "|". */
export function statementLinesFromText(text: string): StatementLine[] {
  const lines: StatementLine[] = []
  let columns: StatementColumn[] | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (isTextHeader(line)) {
      columns = line.split('|').map((cell) => headerKey(cell)).filter((key): key is StatementColumn => key !== null)
      continue
    }
    if (columns && line.includes('|')) {
      const values = line.split('|').map((cell) => cell.trim())
      const cells: Partial<Record<StatementColumn, string>> = {}
      columns.forEach((key, index) => {
        const value = values[index]
        if (value) cells[key] = value
      })
      lines.push({ description: cells.description ?? '', cells })
      continue
    }
    lines.push({ description: line, cells: { description: line } })
  }

  return lines
}

export function readCurrencySection(line: string): CurrencyCode | 'unknown' | null {
  const text = line.trim()
  if (/^d[oó]lares?\s+cv\s*7000\b/i.test(text) || /^d[oó]lar\s+cable\b/i.test(text) || /^usd[\s_-]*cable\b/i.test(text)) {
    return 'USD_CABLE'
  }
  if (/^d[oó]lar(?:es)?\s+mep\b/i.test(text) || /^usd[\s_-]*mep\b/i.test(text)) return 'USD_MEP'
  if (/^pesos\b/i.test(text)) return 'ARS'
  if (/^d[oó]lar(?:es)?\b/i.test(text) || /^usd\b/i.test(text) || /^u\$s?\b/i.test(text)) return 'unknown'
  return null
}

export function readInstrumentHeader(line: string): string | null {
  const match = line.match(/-\s*([A-Z][A-Z0-9.]{1,14})\s*\/\s*\d+\s*$/)
  return match?.[1] ?? null
}

export function readMovementTicker(description: string): string | null {
  const afterSlash = description.match(/\/\s*([A-Z][A-Z0-9.]{1,14})\s*$/)
  if (afterSlash?.[1]) return afterSlash[1]
  const suffix = description.match(/\s-\s*([A-Z][A-Z0-9.]{1,14})\s*$/)
  return suffix?.[1] ?? null
}

export function isRunningBalance(description: string): boolean {
  return /^saldo anterior\b/i.test(description) || /^saldo al\b/i.test(description)
}

export function isDocumentChrome(description: string): boolean {
  return /cuenta corriente por concertaci[oó]n|resumen mensual comitente|^cartera disponible$|^instrumentos$|^monedas$|^comitente\b|balanz capital|www\.balanz\.com|^per[ií]odo\b/i.test(
    description,
  )
}

function lineFromPositionedRow(
  row: PdfTextRow,
  columns: { key: StatementColumn; x: number }[],
): StatementLine {
  const cells: Partial<Record<StatementColumn, string>> = {}
  for (const item of row.items) {
    const key = columnAt(item.x, columns)
    const previous = cells[key]
    cells[key] = previous ? `${previous} ${item.text}` : item.text
  }
  return { description: cells.description ?? '', cells }
}

function headerFromItems(row: PdfTextRow): { key: StatementColumn; x: number }[] | null {
  const columns = row.items.flatMap((item) => {
    const key = headerKey(item.text)
    return key ? [{ key, x: item.x }] : []
  })
  const keys = new Set(columns.map((column) => column.key))
  if (!keys.has('description') || !keys.has('tradeDate')) return null
  return columns.sort((left, right) => left.x - right.x)
}

function isTextHeader(line: string): boolean {
  return /descripci[oó]n/i.test(line) && /fecha co/i.test(line) && line.includes('|')
}

function headerKey(label: string): StatementColumn | null {
  const value = label.trim().toLowerCase().replaceAll('.', '')
  if (value === 'descripción' || value === 'descripcion') return 'description'
  if (value === 'cant vn') return 'quantity'
  if (value === 'saldo') return 'balance'
  if (value === 'precio') return 'price'
  if (value === 'bruto') return 'gross'
  if (value.startsWith('arancel')) return 'fee'
  if (value.startsWith('iva impor')) return 'vatCharge'
  if (value.startsWith('derech')) return 'rights'
  if (value === 'iva') return 'vat'
  if (value === 'neto') return 'net'
  if (value.startsWith('fecha co')) return 'tradeDate'
  if (value.startsWith('fecha li')) return 'settlementDate'
  if (value.startsWith('tipo de cambio') || value === 'tc' || value === 'fx') return 'fxRate'
  return null
}

function columnAt(x: number, columns: { key: StatementColumn; x: number }[]): StatementColumn {
  let found = columns[0]?.key ?? 'description'
  for (const column of columns) {
    if (x + 0.5 >= column.x) found = column.key
    else break
  }
  return found
}
