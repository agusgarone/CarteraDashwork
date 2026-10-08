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

interface ColumnMark {
  key: StatementColumn
  x: number
}

const HEADER_ROW_GAP = 18

/**
 * Arma filas de la cuenta corriente.
 * Cada página recalcula las columnas desde su encabezado visual.
 * "Fecha" y "Co." pueden venir en ítems y filas distintas: se unen por X.
 */
export function statementLinesFromPdf(document: PdfTextDocument): StatementLine[] {
  const lines: StatementLine[] = []
  let page: number | null = null
  let columns: ColumnMark[] | null = null
  const rows = document.rows

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) continue
    if (row.page !== page) {
      page = row.page
      columns = null
    }
    if (isHeaderFragment(row)) {
      const header = headerWindow(rows, index)
      if (header) {
        columns = header.columns
        index = header.lastIndex
        continue
      }
    }
    if (!columns) {
      const description = row.items.map((item) => item.text).join(' ').trim()
      if (description.length > 0) lines.push({ description, cells: { description } })
      continue
    }
    const merged = mergeSplitRow(rows, index, columns)
    if (merged) {
      lines.push(lineFromPositionedRow(merged.row, columns))
      index = merged.lastIndex
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

const ARGENTINE_TOKEN = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/

function lineFromPositionedRow(row: PdfTextRow, columns: ColumnMark[]): StatementLine {
  const cells: Partial<Record<StatementColumn, string>> = {}
  for (const item of row.items) {
    for (const piece of piecesOf(item, columns)) {
      const previous = cells[piece.key]
      cells[piece.key] = previous ? `${previous} ${piece.text}` : piece.text
    }
  }
  return { description: cells.description ?? '', cells }
}

function piecesOf(
  item: PdfTextRow['items'][number],
  columns: ColumnMark[],
): { key: StatementColumn; text: string }[] {
  const tokens = item.text.split(/\s+/).filter((token) => token.length > 0)
  const numeric = tokens.length > 1 && tokens.every((token) => ARGENTINE_TOKEN.test(token))
  if (!numeric || item.width <= 0) {
    return [{ key: columnAt(item.x, columns), text: item.text }]
  }
  const startColumn = columnAt(item.x, columns)
  const endColumn = columnAt(item.x + item.width - 0.5, columns)
  if (endColumn === startColumn) {
    return [{ key: startColumn, text: item.text }]
  }
  const slice = item.width / tokens.length
  return tokens.map((token, index) => ({
    key: columnAt(item.x + slice * (index + 0.5), columns),
    text: token,
  }))
}

/**
 * Balanz a veces deja la descripción 6 px arriba de los importes de la misma fila.
 * Si la fila de arriba es solo texto y la de abajo trae la fecha, son una sola operación.
 */
function mergeSplitRow(
  rows: readonly PdfTextRow[],
  index: number,
  columns: ColumnMark[],
): { row: PdfTextRow; lastIndex: number } | null {
  const origin = rows[index]
  const next = rows[index + 1]
  if (!origin || !next || next.page !== origin.page) return null
  const gap = origin.y - next.y
  if (gap <= 0 || gap > 8) return null
  if (isHeaderFragment(origin) || isHeaderFragment(next)) return null
  const originOnlyDescription = origin.items.every((entry) => columnAt(entry.x, columns) === 'description')
  const nextHasDescription = next.items.some((entry) => columnAt(entry.x, columns) === 'description')
  const nextHasDate = next.items.some((entry) => {
    const key = columnAt(entry.x, columns)
    return key === 'tradeDate' || key === 'settlementDate'
  })
  if (!originOnlyDescription || nextHasDescription || !nextHasDate) return null
  return {
    lastIndex: index + 1,
    row: {
      page: origin.page,
      y: origin.y,
      items: [...origin.items, ...next.items].sort((left, right) => left.x - right.x),
    },
  }
}

function headerWindow(
  rows: readonly PdfTextRow[],
  start: number,
): { columns: ColumnMark[]; lastIndex: number } | null {
  const origin = rows[start]
  if (!origin || !isHeaderFragment(origin)) return null
  const window: PdfTextRow[] = [origin]
  let lastIndex = start
  for (let index = start + 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row || row.page !== origin.page) break
    if (origin.y - row.y > HEADER_ROW_GAP) break
    if (!isHeaderFragment(row)) break
    window.push(row)
    lastIndex = index
  }
  const columns = columnsFromWindow(window)
  if (!columns) return null
  return { columns, lastIndex }
}

function columnsFromWindow(rows: readonly PdfTextRow[]): ColumnMark[] | null {
  const clusters: { x: number; parts: { y: number; text: string }[] }[] = []
  const fragments = rows.flatMap((row) => row.items.map((item) => ({ x: item.x, y: row.y, text: item.text })))
  for (const fragment of fragments.sort((left, right) => left.x - right.x || right.y - left.y)) {
    const cluster = clusters.find((candidate) => Math.abs(candidate.x - fragment.x) <= 8)
    if (!cluster) {
      clusters.push({ x: fragment.x, parts: [{ y: fragment.y, text: fragment.text }] })
      continue
    }
    cluster.parts.push({ y: fragment.y, text: fragment.text })
  }

  const columns: ColumnMark[] = []
  for (const cluster of clusters) {
    const label = cluster.parts
      .sort((left, right) => right.y - left.y)
      .map((part) => part.text.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
    const key = headerKey(label)
    if (!key) continue
    columns.push({ key, x: cluster.x })
  }
  const keys = new Set(columns.map((column) => column.key))
  if (!keys.has('description') || !keys.has('tradeDate')) return null
  return columns.sort((left, right) => left.x - right.x)
}

function isHeaderFragment(row: PdfTextRow): boolean {
  return row.items.length > 0 && row.items.every((item) => isHeaderWord(item.text))
}

function isHeaderWord(text: string): boolean {
  const value = text.trim().toLowerCase().replaceAll('.', '').replace(/\s+/g, ' ')
  if (headerKey(value)) return true
  return /^(cant|vn|impor|fecha|co|li|arancel|iva|derech)$/.test(value)
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

function columnAt(x: number, columns: ColumnMark[]): StatementColumn {
  let found = columns[0]?.key ?? 'description'
  for (const column of columns) {
    if (x + 0.5 >= column.x) found = column.key
    else break
  }
  return found
}
