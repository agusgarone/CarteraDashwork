import { read, utils, type WorkSheet } from 'xlsx'
import type { CurrencyCode } from '../../domain/currency'
import type {
  ParsedPeriodResults,
  PeriodResultsFxSelection,
  PeriodResultsLotRow,
} from '../models/parsedPeriodResults'

export const INITIAL_LOTS_SHEET = 'resultados_por_lotes_iniciales'
export const REALIZED_SHEET = 'resultados_por_realizado'
export const FINAL_LOTS_SHEET = 'resultados_por_lotes_finales'

const LOT_HEADERS = [
  'Cantidad',
  'Descripcion',
  'Fecha',
  'Fecha Lote',
  'Gastos',
  'Moneda',
  'Operacion',
  'Precio Compra',
  'Ticker',
  'Tipo',
  'DolarCCL',
  'DolarMEP',
  'DolarOficial',
] as const

const REALIZED_HEADERS = [
  'Cantidad',
  'Descripcion',
  'Fecha',
  'FechaCompra',
  'Gastos',
  'Moneda Compra',
  'Moneda Venta',
  'Operacion Compra',
  'Operacion Venta',
  'Precio Compra',
  'PrecioVenta',
  'Ticker',
  'Tipo',
  'Tipo Movimiento',
  'Cupones',
  'Dividendos',
  'Intereses',
  'MTMFuturos',
  'OperacionCompraDolarCCL',
  'OperacionCompraDolarMEP',
  'OperacionCompraDolarOficial',
  'OperacionVentaDolarCCL',
  'OperacionVentaDolarMEP',
  'OperacionVentaDolarOficial',
] as const

const SHEETS = [INITIAL_LOTS_SHEET, REALIZED_SHEET, FINAL_LOTS_SHEET] as const

export class PeriodResultsFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PeriodResultsFormatError'
  }
}

/**
 * Lee Resultados del período desde los bytes del xlsx.
 * Las hojas de lotes solo aportan la fecha de apertura y de cierre.
 * El resultado del engine no usa el P/L de Balanz.
 * Los importes salen del texto formateado de la celda, no de un número binario.
 */
export function parseBalanzPeriodResults(bytes: Uint8Array): ParsedPeriodResults {
  if (!isXlsx(bytes)) {
    throw new PeriodResultsFormatError('El archivo no es un Excel .xlsx.')
  }
  const workbook = read(bytes, { type: 'buffer', cellDates: false })
  if (!sameSheets(workbook.SheetNames)) {
    throw new PeriodResultsFormatError('El Excel no tiene las hojas de Resultados del período.')
  }
  const initial = readSheet(workbook.Sheets[INITIAL_LOTS_SHEET], INITIAL_LOTS_SHEET, LOT_HEADERS)
  const realized = readSheet(workbook.Sheets[REALIZED_SHEET], REALIZED_SHEET, REALIZED_HEADERS)
  const finalLots = readSheet(workbook.Sheets[FINAL_LOTS_SHEET], FINAL_LOTS_SHEET, LOT_HEADERS)
  const openingDate = uniqueLotDate(initial, INITIAL_LOTS_SHEET)
  const closingDate = uniqueLotDate(finalLots, FINAL_LOTS_SHEET)
  const selections = realized.flatMap((row) => selectionsFromRow(row))
  assertConsistentObservations(selections)
  return {
    documentType: 'PERIOD_RESULTS',
    openingDate,
    closingDate,
    initialLotCount: initial.length,
    realizedCount: realized.length,
    finalLotCount: finalLots.length,
    initialLots: initial.map((row) => lotRow(INITIAL_LOTS_SHEET, row)),
    finalLots: finalLots.map((row) => lotRow(FINAL_LOTS_SHEET, row)),
    selections,
  }
}

export function isPeriodResultsWorkbook(bytes: Uint8Array): boolean {
  try {
    parseBalanzPeriodResults(bytes)
    return true
  } catch {
    return false
  }
}

export function operationReferenceFromText(value: string | null | undefined): string | null {
  const match = value?.match(/boleto\s*\/\s*(\d+)\s*\//i)
  return match?.[1] ?? null
}

export function normalizePeriodResultsCurrency(value: string | null | undefined): CurrencyCode | null {
  const text = value?.trim().toLowerCase() ?? ''
  if (!text) return null
  if (text.includes('cable') || text.includes('c.v') || text.includes('7000')) return 'USD_CABLE'
  if (text === 'dólares' || text === 'dolares' || text === 'usd mep' || text === 'usd_mep') return 'USD_MEP'
  if (text === 'pesos' || text === 'ars') return 'ARS'
  return null
}

function lotRow(sheet: PeriodResultsLotRow['sheet'], row: SheetRow): PeriodResultsLotRow {
  return {
    sheet,
    rowNumber: row.rowNumber,
    lotDate: requiredDate(cell(row, 'Fecha Lote'), `${sheet} fila ${row.rowNumber}`),
    ticker: cell(row, 'Ticker'),
  }
}

function selectionsFromRow(row: SheetRow): PeriodResultsFxSelection[] {
  const movement = cell(row, 'Tipo Movimiento')
  const ticker = cell(row, 'Ticker')
  const quantity = decimalText(cell(row, 'Cantidad'))
  const selected: PeriodResultsFxSelection[] = []
  if (movement === 'Dividendo' || movement === 'Cupón') {
    const income = foreignFx(row, 'SALE', cell(row, 'Moneda Venta'))
    if (!income) return []
    selected.push({
      side: 'INCOME',
      operationReference: null,
      currency: income.currency,
      kind: income.kind,
      rate: income.rate,
      column: income.column,
      date: requiredDate(cell(row, 'Fecha'), `${REALIZED_SHEET} fila ${row.rowNumber}`),
      ticker,
      movementType: movement,
      quantity,
      rowNumber: row.rowNumber,
      sheet: REALIZED_SHEET,
    })
    return selected
  }
  if (movement !== 'Orden' && movement !== 'No Realizado') return []

  const purchase = foreignFx(row, 'PURCHASE', cell(row, 'Moneda Compra'))
  if (purchase) {
    const reference = operationReferenceFromText(cell(row, 'Operacion Compra'))
    if (reference) {
      const purchaseDate = cell(row, 'FechaCompra') || cell(row, 'Fecha')
      selected.push({
        side: 'BUY',
        operationReference: reference,
        currency: purchase.currency,
        kind: purchase.kind,
        rate: purchase.rate,
        column: purchase.column,
        date: requiredDate(purchaseDate, `${REALIZED_SHEET} fila ${row.rowNumber}`),
        ticker,
        movementType: movement,
        quantity,
        rowNumber: row.rowNumber,
        sheet: REALIZED_SHEET,
      })
    }
  }
  const sale = foreignFx(row, 'SALE', cell(row, 'Moneda Venta'))
  if (sale) {
    const reference = operationReferenceFromText(cell(row, 'Operacion Venta'))
    if (reference) {
      selected.push({
        side: 'SELL',
        operationReference: reference,
        currency: sale.currency,
        kind: sale.kind,
        rate: sale.rate,
        column: sale.column,
        date: requiredDate(cell(row, 'Fecha'), `${REALIZED_SHEET} fila ${row.rowNumber}`),
        ticker,
        movementType: movement,
        quantity,
        rowNumber: row.rowNumber,
        sheet: REALIZED_SHEET,
      })
    }
  }
  return selected
}

function foreignFx(
  row: SheetRow,
  side: 'PURCHASE' | 'SALE',
  currencyText: string,
): { currency: Exclude<CurrencyCode, 'ARS'>; kind: 'MEP' | 'CCL'; rate: string; column: string } | null {
  const currency = normalizePeriodResultsCurrency(currencyText)
  if (currency === null || currency === 'ARS') return null
  const column =
    currency === 'USD_MEP'
      ? side === 'PURCHASE'
        ? 'OperacionCompraDolarMEP'
        : 'OperacionVentaDolarMEP'
      : side === 'PURCHASE'
        ? 'OperacionCompraDolarCCL'
        : 'OperacionVentaDolarCCL'
  const rate = decimalText(cell(row, column))
  if (!rate) {
    throw new PeriodResultsFormatError(`La fila ${row.rowNumber} no trae ${column}.`)
  }
  return { currency, kind: currency === 'USD_MEP' ? 'MEP' : 'CCL', rate, column }
}

function assertConsistentObservations(selections: readonly PeriodResultsFxSelection[]): void {
  const seen = new Map<string, string>()
  for (const selection of selections) {
    const key = `${selection.date}|${selection.kind}`
    const previous = seen.get(key)
    if (previous !== undefined && previous !== selection.rate) {
      throw new PeriodResultsFormatError(
        `El tipo de cambio ${selection.kind} del ${selection.date} no coincide entre filas del Excel.`,
      )
    }
    seen.set(key, selection.rate)
  }
}

function uniqueLotDate(rows: readonly SheetRow[], sheet: string): string {
  const dates = [...new Set(rows.map((row) => requiredDate(cell(row, 'Fecha Lote'), sheet)))]
  if (dates.length !== 1) {
    throw new PeriodResultsFormatError(`La hoja ${sheet} no tiene una única fecha de lote.`)
  }
  return dates[0] ?? ''
}

interface SheetRow {
  rowNumber: number
  cells: Map<string, string>
}

function readSheet(sheet: WorkSheet | undefined, name: string, headers: readonly string[]): SheetRow[] {
  if (!sheet) throw new PeriodResultsFormatError(`Falta la hoja ${name}.`)
  const matrix = utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][]
  const header = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim())
  if (header.length !== headers.length || header.some((name, index) => name !== headers[index])) {
    throw new PeriodResultsFormatError(`La hoja ${name} no tiene las columnas de Resultados del período.`)
  }
  const rows: SheetRow[] = []
  for (let index = 1; index < matrix.length; index += 1) {
    const values = (matrix[index] ?? []).map((cell) => String(cell ?? '').trim())
    if (values.every((value) => value === '')) continue
    rows.push({
      rowNumber: index + 1,
      cells: new Map(headers.map((column, columnIndex) => [column, values[columnIndex] ?? ''])),
    })
  }
  return rows
}

function cell(row: SheetRow, column: string): string {
  return row.cells.get(column) ?? ''
}

function requiredDate(value: string, context: string): string {
  const date = isoDate(value)
  if (!date) throw new PeriodResultsFormatError(`Falta la fecha en ${context}.`)
  return date
}

function isoDate(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new PeriodResultsFormatError(`No se reconoce la fecha ${value}.`)
  }
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

function decimalText(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  let normalized = trimmed.replace(/\s/g, '')
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized =
      normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(/,/g, '')
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.')
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new PeriodResultsFormatError(`No se reconoce el importe ${value}.`)
  }
  return normalized
}

function sameSheets(names: readonly string[]): boolean {
  return names.length === SHEETS.length && SHEETS.every((name, index) => names[index] === name)
}

function isXlsx(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}
