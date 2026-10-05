import type { CurrencyCode } from '../../domain/currency'
import { ParserError } from '../errors/parserErrors'
import type { ParserWarning } from '../models/parsedMonthlyAccount'
import type {
  ParsedFundStatement,
  ParsedFundStatementRow,
  ParsedFundStatementRowType,
  ParsedMonthlyFundStatement,
} from '../models/parsedMonthlyFundStatement'
import { parseBalanzDate, readScaledAmount } from '../text/argentinianFormat'
import { extractPdfDocument, type PdfTextDocument, type PdfTextItem, type PdfTextRow } from '../text/extractPdfText'

const FUND_HEADER =
  /^(.+?)\s*\|\s*(.+?)\s*-\s*Clase\s+([A-Za-z0-9]+)(?:\s*\|\s*|\s+)([A-Za-z][A-Za-z_]*)\s*$/i
const REPORT_DATE =
  /informe del total de su inversi[oó]n al:?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2})/i

type FundColumn = 'date' | 'concept' | 'unitValue' | 'quantity' | 'amount'

interface ColumnMark {
  key: FundColumn
  x: number
}

interface OpenFund {
  categoryName: string
  fundName: string
  shareClass: string
  currency: CurrencyCode
  rows: ParsedFundStatementRow[]
}

/**
 * Lee un resumen de fondos comunes de inversión.
 * La fila "Total de inversión" no trae fecha: usa la fecha del encabezado
 * "Informe del total de su inversión al". El saldo anterior conserva la fecha
 * que imprime la fila. No resta un mes.
 * No conoce la posición consolidada ni sus tickers.
 */
export function parseBalanzMonthlyFundStatementText(text: string): ParsedMonthlyFundStatement {
  assertFundStatement(text)
  const reportDate = readReportDate(text)
  return buildResult(reportDate, fundsFromText(text, reportDate))
}

export async function parseBalanzMonthlyFundStatementPdf(data: Uint8Array): Promise<ParsedMonthlyFundStatement> {
  const document = await extractPdfDocument(data)
  return parseBalanzMonthlyFundStatementDocument(document)
}

export function parseBalanzMonthlyFundStatementDocument(document: PdfTextDocument): ParsedMonthlyFundStatement {
  assertFundStatement(document.text)
  const reportDate = readReportDate(document.text)
  return buildResult(reportDate, fundsFromPdf(document, reportDate))
}

function assertFundStatement(text: string): void {
  if (!/fondo com[uú]n de inversi[oó]n/i.test(text) || !/informe del total de su inversi[oó]n/i.test(text)) {
    throw new ParserError('El documento no es un resumen de fondos comunes de inversión.')
  }
}

function readReportDate(text: string): string {
  const match = text.match(REPORT_DATE)
  const date = match ? readDate(match[1] ?? '') : null
  if (!date) {
    throw new ParserError('El resumen de fondos no indica la fecha del informe.')
  }
  return date
}

function buildResult(
  reportDate: string,
  parsed: { funds: ParsedFundStatement[]; warnings: ParserWarning[] },
): ParsedMonthlyFundStatement {
  return {
    broker: 'BALANZ',
    reportDate,
    funds: parsed.funds,
    warnings: parsed.warnings,
  }
}

function fundsFromText(text: string, reportDate: string): { funds: ParsedFundStatement[]; warnings: ParserWarning[] } {
  const warnings: ParserWarning[] = []
  const funds: ParsedFundStatement[] = []
  let current: OpenFund | null = null
  let columns: FundColumn[] | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || isIgnored(line)) continue
    const header = readFundHeader(line)
    if (header) {
      if (current) funds.push(finishFund(current))
      current = { ...header, rows: [] }
      columns = null
      continue
    }
    if (isColumnHeader(line)) {
      columns = line.split('|').map((cell) => columnKey(cell)).filter((key): key is FundColumn => key !== null)
      continue
    }
    if (!current || !columns || !line.includes('|')) continue
    const values = line.split('|').map((cell) => cell.trim())
    const cells: Partial<Record<FundColumn, string>> = {}
    columns.forEach((key, index) => {
      const value = values[index]
      if (value) cells[key] = value
    })
    const row = toRow(cells, reportDate, current, warnings)
    if (row) current.rows.push(row)
  }

  if (current) funds.push(finishFund(current))
  return { funds, warnings }
}

function fundsFromPdf(document: PdfTextDocument, reportDate: string): { funds: ParsedFundStatement[]; warnings: ParserWarning[] } {
  const warnings: ParserWarning[] = []
  const funds: ParsedFundStatement[] = []
  let current: OpenFund | null = null
  let columns: ColumnMark[] | null = null

  for (const row of document.rows) {
    const text = joinRow(row)
    if (text.length === 0 || isIgnored(text)) continue
    const header = readFundHeader(text)
    if (header) {
      if (current) funds.push(finishFund(current))
      current = { ...header, rows: [] }
      columns = null
      continue
    }
    const headerColumns = headerFromRow(row)
    if (headerColumns) {
      columns = headerColumns
      continue
    }
    if (!current || !columns) continue
    const parsed = toRow(cellsFromRow(row, columns), reportDate, current, warnings)
    if (parsed) current.rows.push(parsed)
  }

  if (current) funds.push(finishFund(current))
  return { funds, warnings }
}

function finishFund(fund: OpenFund): ParsedFundStatement {
  return {
    categoryName: fund.categoryName,
    fundName: fund.fundName,
    shareClass: fund.shareClass,
    currency: fund.currency,
    rows: fund.rows,
  }
}

function readFundHeader(line: string): Omit<OpenFund, 'rows'> | null {
  const match = line.match(FUND_HEADER)
  if (!match) return null
  const currency = readCurrency(match[4] ?? '')
  if (!currency) return null
  const shareClass = (match[3] ?? '').trim()
  if (shareClass.length === 0) return null
  return {
    categoryName: (match[1] ?? '').trim(),
    fundName: (match[2] ?? '').trim(),
    shareClass,
    currency,
  }
}

function toRow(
  cells: Partial<Record<FundColumn, string>>,
  reportDate: string,
  fund: OpenFund,
  warnings: ParserWarning[],
): ParsedFundStatementRow | null {
  const unitValue = scaled(cells.unitValue)
  const quantity = scaled(cells.quantity)
  const amount = scaled(cells.amount)
  if (!unitValue && !quantity && !amount) return null

  const dateCell = cells.date?.trim() ?? ''
  const explicitDate = readDate(dateCell)
  const concept = (cells.concept?.trim() || (!explicitDate ? dateCell : '')).trim()
  const sourceReference = [fund.fundName, concept].filter((part) => part.length > 0).join(' / ')
  if (concept.length === 0) {
    warnings.push(warning('AMBIGUOUS_ROW', 'La fila del fondo no tiene concepto.', sourceReference))
    return null
  }

  const type = rowType(concept)
  if (type === 'OTHER') {
    warnings.push(warning('UNKNOWN_MOVEMENT', `No se reconoce el concepto "${concept}".`, sourceReference))
  }

  const date = explicitDate ?? (type === 'CURRENT_INVESTMENT' ? reportDate : null)
  if (!date) {
    warnings.push(warning('MISSING_DATE', 'La fila no tiene fecha y no es el total del informe.', sourceReference))
    return null
  }
  if (!amount) {
    warnings.push(warning('MISSING_AMOUNT', 'La fila no informa el monto.', sourceReference))
  }
  if (!quantity) {
    warnings.push(warning('MISSING_QUANTITY', 'La fila no informa la cantidad de cuotapartes.', sourceReference))
  }

  return {
    type,
    date,
    unitValue,
    quantity,
    amount,
    sourceReference,
  }
}

function rowType(concept: string): ParsedFundStatementRowType {
  if (/saldo anterior/i.test(concept)) return 'PREVIOUS_BALANCE'
  if (/total de inversi[oó]n/i.test(concept)) return 'CURRENT_INVESTMENT'
  if (/suscripci[oó]n/i.test(concept)) return 'SUBSCRIPTION'
  if (/rescate/i.test(concept)) return 'REDEMPTION'
  return 'OTHER'
}

function readCurrency(raw: string): CurrencyCode | null {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '_')
  if (value === 'ARS' || value === 'PESOS') return 'ARS'
  if (value === 'USD_MEP' || value === 'MEP') return 'USD_MEP'
  if (value === 'USD_CABLE' || value === 'CABLE') return 'USD_CABLE'
  return null
}

function readDate(raw: string): string | null {
  const iso = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return parseBalanzDate(`${iso[3]}/${iso[2]}/${iso[1]}`)
  return parseBalanzDate(raw)
}

function scaled(raw: string | undefined): string | null {
  if (!raw) return null
  const read = readScaledAmount(raw)
  if (!read) return null
  return read.value.isNegative() ? `-${read.text}` : read.text
}

function isColumnHeader(line: string): boolean {
  return /fecha/i.test(line) && /valor de cuota/i.test(line) && /monto/i.test(line) && line.includes('|')
}

function headerFromRow(row: PdfTextRow): ColumnMark[] | null {
  const columns = row.items.flatMap((item) => {
    const key = columnKey(item.text)
    return key ? [{ key, x: item.x }] : []
  })
  const keys = new Set(columns.map((column) => column.key))
  if (!keys.has('date') || !keys.has('unitValue') || !keys.has('quantity') || !keys.has('amount')) return null
  return columns.sort((left, right) => left.x - right.x)
}

function columnKey(label: string): FundColumn | null {
  const value = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[().$]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (value.includes('fecha')) return 'date'
  if (value === 'concepto') return 'concept'
  if (value.includes('valor') && value.includes('cuota')) return 'unitValue'
  if (value.includes('cuota')) return 'quantity'
  if (value.startsWith('monto')) return 'amount'
  return null
}

function cellsFromRow(row: PdfTextRow, columns: readonly ColumnMark[]): Partial<Record<FundColumn, string>> {
  const cells: Partial<Record<FundColumn, string>> = {}
  for (const item of row.items) {
    const key = columnAt(item, columns)
    const previous = cells[key]
    cells[key] = previous ? `${previous} ${item.text}` : item.text
  }
  return cells
}

function columnAt(item: PdfTextItem, columns: readonly ColumnMark[]): FundColumn {
  let found = columns[0]?.key ?? 'date'
  for (const column of columns) {
    if (item.x + 0.5 >= column.x) found = column.key
    else break
  }
  return found
}

function joinRow(row: PdfTextRow): string {
  return row.items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim()
}

function isIgnored(text: string): boolean {
  return /cuotapartista|domicilio|^\s*cuit\b|agente de |balanz capital|www\.balanz\.com|detalle de movimiento/i.test(text)
}

function warning(code: ParserWarning['code'], message: string, sourceReference: string): ParserWarning {
  return { code, message, sourceReference }
}
