import Decimal from 'decimal.js'
import type { CurrencyCode } from '../../domain/currency'
import { ParserError } from '../errors/parserErrors'
import type { ParserWarning } from '../models/parsedMonthlyAccount'
import type {
  NormalizedHoldingCategory,
  ParsedCashBalance,
  ParsedCategoryTotal,
  ParsedConsolidatedPosition,
  ParsedPosition,
  PositionDocumentReconciliation,
} from '../models/parsedConsolidatedPosition'
import {
  formatCalculated,
  formatQuantity,
  parseArgentineNumber,
  parseBalanzDate,
  readScaledAmount,
} from '../text/argentinianFormat'
import {
  extractPdfDocument,
  type PdfTextDocument,
  type PdfTextItem,
  type PdfTextRow,
} from '../text/extractPdfText'

const TITLE = /posici[oó]n consolidada/i
const TICKER = /^[A-Z][A-Z0-9.]{1,14}$/
const DATE_TOKEN = '(\\d{1,2}/\\d{1,2}/\\d{4})'

type ScaledAmount = { value: Decimal; text: string }
type PositionColumn = 'ticker' | 'name' | 'quantity' | 'guarantee' | 'price' | 'marketValue'

interface RawCash {
  currency: CurrencyCode
  amount: ScaledAmount
  label: string
}

interface ColumnMark {
  key: PositionColumn
  x: number
}

interface PositionDraft {
  rawCategory: string
  normalizedCategory: NormalizedHoldingCategory
  cells: Partial<Record<PositionColumn, string>>
}

/**
 * Lee una Posición consolidada por concertación.
 * Dice qué foto trae el documento. No completa cifras con otro reporte,
 * no calcula el valor de mercado como cantidad por precio y no persiste.
 *
 * Los FCI pueden venir con menos decimales que el resumen cuotapartista.
 * Esa diferencia se resuelve en el import, no acá.
 */
export function parseBalanzConsolidatedPositionText(text: string): ParsedConsolidatedPosition {
  assertConsolidatedPosition(text)
  return assemble(text, draftsFromText(text))
}

export async function parseBalanzConsolidatedPositionPdf(data: Uint8Array): Promise<ParsedConsolidatedPosition> {
  const document = await extractPdfDocument(data)
  return parseBalanzConsolidatedPositionDocument(document)
}

export function parseBalanzConsolidatedPositionDocument(document: PdfTextDocument): ParsedConsolidatedPosition {
  assertConsolidatedPosition(document.text)
  return assemble(document.text, draftsFromPdf(document))
}

function assertConsolidatedPosition(text: string): void {
  if (!TITLE.test(text)) {
    throw new ParserError('El documento no es una Posición consolidada.')
  }
}

function assemble(text: string, drafts: readonly PositionDraft[]): ParsedConsolidatedPosition {
  const warnings: ParserWarning[] = []
  const positions: ParsedPosition[] = []
  const seen = new Set<string>()
  const categoryTotals: ParsedCategoryTotal[] = []
  const rawCash: RawCash[] = []
  let snapshotDate: string | null = null
  let issuedAt: string | null = null
  let reportedTotal: string | null = null
  let mepRate: ScaledAmount | null = null
  let cableRate: ScaledAmount | null = null
  let holders = false

  for (const block of textBlocks(text)) {
    if (/informaci[oó]n de titulares/i.test(block)) {
      holders = true
      continue
    }
    if (holders || isIgnoredProse(block)) continue

    const snapshot = block.match(new RegExp(`fecha resumen\\s*(?:\\|\\s*)?${DATE_TOKEN}`, 'i'))
    const issued = block.match(new RegExp(`fecha de emisi[oó]n\\s*(?:\\|\\s*)?${DATE_TOKEN}`, 'i'))
    if (snapshot?.[1]) snapshotDate = parseBalanzDate(snapshot[1]) ?? snapshotDate
    if (issued?.[1]) issuedAt = parseBalanzDate(issued[1]) ?? issuedAt

    if (/tipo de cambio/i.test(block)) {
      mepRate = readRate(block, /MEP\s*\$\s*([\d.,]+)/i) ?? mepRate
      cableRate = readRate(block, /US Dollar\s*\$\s*([\d.,]+)/i) ?? cableRate
      continue
    }

    const total = block.match(/(?:^|\s)total\s*(?:\|\s*)?\$\s*([\d.,]+)/i)
    if (total?.[1]) reportedTotal = readScaledAmount(total[1])?.text ?? reportedTotal

    for (const match of block.matchAll(/(?:^|\s)(acciones|cedears|corporativos|fondos)\s*(?:\|\s*)?\$\s*([\d.,]+)/gi)) {
      const label = match[1]
      const amount = match[2] ? readScaledAmount(match[2]) : null
      const normalized = label ? normalizeCategory(label) : null
      if (!normalized || !amount) continue
      categoryTotals.push({
        rawCategory: canonicalCategoryLabel(normalized),
        normalizedCategory: normalized,
        reportedTotal: amount.text,
      })
    }

    const cash = readCashMention(block)
    if (cash === 'unknown') {
      warnings.push(warning('UNKNOWN_CURRENCY', 'La moneda de la caja no está reconocida.', block))
    } else if (cash) {
      rawCash.push(cash)
    }
  }

  const cashBalances = rawCash.map((cash) => toCashBalance(cash, mepRate, cableRate, warnings))

  for (const draft of drafts) {
    const position = toPosition(draft, warnings)
    if (!position) continue
    if (seen.has(position.ticker)) {
      warnings.push(warning('DUPLICATE_INSTRUMENT', `El instrumento ${position.ticker} aparece más de una vez.`, position.sourceReference))
    }
    seen.add(position.ticker)
    positions.push(position)
  }

  if (!snapshotDate) {
    throw new ParserError('La posición consolidada no indica la fecha del resumen.')
  }
  if (!reportedTotal) {
    throw new ParserError('La posición consolidada no indica el total.')
  }

  const reconciliation = reconcile(positions, cashBalances, categoryTotals, reportedTotal, warnings)
  return {
    broker: 'BALANZ',
    snapshotDate,
    issuedAt,
    reportedTotal,
    positions,
    cashBalances,
    categoryTotals,
    reconciliation,
    warnings,
  }
}

function draftsFromText(text: string): PositionDraft[] {
  const drafts: PositionDraft[] = []
  let columns: PositionColumn[] | null = null
  let category: { raw: string; normalized: NormalizedHoldingCategory } | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || /tipo de cambio/i.test(line)) continue
    if (isPositionHeader(line)) {
      columns = line.split('|').map((cell) => columnKey(cell)).filter((key): key is PositionColumn => key !== null)
      continue
    }
    const section = loneCategory(line)
    if (section) {
      category = section
      columns = null
      continue
    }
    if (!columns || !category || !line.includes('|')) continue
    const values = line.split('|').map((cell) => cell.trim())
    const cells: Partial<Record<PositionColumn, string>> = {}
    columns.forEach((key, index) => {
      const value = values[index]
      if (value) cells[key] = value
    })
    drafts.push({ rawCategory: category.raw, normalizedCategory: category.normalized, cells })
  }

  return drafts
}

function draftsFromPdf(document: PdfTextDocument): PositionDraft[] {
  const drafts: PositionDraft[] = []
  let columns: ColumnMark[] | null = null
  let category: { raw: string; normalized: NormalizedHoldingCategory } | null = null

  for (const row of document.rows) {
    const text = joinRow(row)
    if (text.length === 0 || /tipo de cambio/i.test(text)) continue
    const header = headerFromRow(row)
    if (header) {
      columns = header
      continue
    }
    const section = loneCategory(text)
    if (section) {
      category = section
      columns = null
      continue
    }
    if (!columns || !category) continue
    drafts.push({
      rawCategory: category.raw,
      normalizedCategory: category.normalized,
      cells: cellsFromRow(row, columns),
    })
  }

  return drafts
}

function toPosition(draft: PositionDraft, warnings: ParserWarning[]): ParsedPosition | null {
  const ticker = draft.cells.ticker?.trim() ?? ''
  if (!TICKER.test(ticker)) return null

  const name = draft.cells.name?.trim() ?? ''
  const sourceReference = [ticker, name].filter((part) => part.length > 0).join(' ')
  const quantity = draft.cells.quantity ? parseArgentineNumber(stripCurrency(draft.cells.quantity)) : null
  const market = draft.cells.marketValue ? readScaledAmount(draft.cells.marketValue) : null
  if (!quantity && !market) return null
  if (!quantity) {
    warnings.push(warning('MISSING_QUANTITY', 'La tenencia no indica la cantidad.', sourceReference))
    return null
  }
  if (!market) {
    warnings.push(warning('MISSING_MARKET_VALUE', 'La tenencia no indica el valor actual.', sourceReference))
    return null
  }

  const price = draft.cells.price ? readScaledAmount(draft.cells.price) : null
  const guarantee = draft.cells.guarantee ? readScaledAmount(draft.cells.guarantee) : null
  return {
    ticker,
    name,
    rawCategory: draft.rawCategory,
    normalizedCategory: draft.normalizedCategory,
    quantity: formatQuantity(quantity),
    guarantee: guarantee?.text ?? null,
    unitPrice: price?.text ?? null,
    marketValue: market.text,
    sourceReference,
  }
}

function toCashBalance(
  cash: RawCash,
  mepRate: ScaledAmount | null,
  cableRate: ScaledAmount | null,
  warnings: ParserWarning[],
): ParsedCashBalance {
  if (cash.currency === 'ARS') {
    return {
      currency: 'ARS',
      amount: cash.amount.text,
      fxRate: null,
      reportedValueInBaseCurrency: cash.amount.text,
      calculatedValueInBaseCurrency: cash.amount.text,
    }
  }

  const rate = cash.currency === 'USD_MEP' ? mepRate : cableRate
  if (!rate) {
    warnings.push(warning('AMBIGUOUS_ROW', 'La caja en dólares no tiene un tipo de cambio en el documento.', cash.label))
    return {
      currency: cash.currency,
      amount: cash.amount.text,
      fxRate: null,
      reportedValueInBaseCurrency: null,
      calculatedValueInBaseCurrency: null,
    }
  }

  return {
    currency: cash.currency,
    amount: cash.amount.text,
    fxRate: rate.text,
    reportedValueInBaseCurrency: null,
    calculatedValueInBaseCurrency: formatCalculated(cash.amount.value.times(rate.value)),
  }
}

function reconcile(
  positions: readonly ParsedPosition[],
  cashBalances: readonly ParsedCashBalance[],
  categoryTotals: readonly ParsedCategoryTotal[],
  reportedTotal: string,
  warnings: ParserWarning[],
): PositionDocumentReconciliation {
  const positionsTotal = positions.reduce((total, position) => total.plus(position.marketValue), new Decimal(0))
  const cashCalculatedTotal = cashBalances.reduce((total, balance) => {
    if (balance.calculatedValueInBaseCurrency === null) return total
    return total.plus(balance.calculatedValueInBaseCurrency)
  }, new Decimal(0))
  const calculatedPortfolioTotal = positionsTotal.plus(cashCalculatedTotal)
  const reported = new Decimal(reportedTotal)

  return {
    positionsTotal: formatCalculated(positionsTotal),
    cashCalculatedTotal: formatCalculated(cashCalculatedTotal),
    calculatedPortfolioTotal: formatCalculated(calculatedPortfolioTotal),
    reportedPortfolioTotal: formatCalculated(reported),
    difference: formatCalculated(calculatedPortfolioTotal.minus(reported)),
    categoryChecks: categoryTotals.map((category) => {
      const calculated = positions
        .filter((position) => position.normalizedCategory === category.normalizedCategory)
        .reduce((total, position) => total.plus(position.marketValue), new Decimal(0))
      const reportedCategory = new Decimal(category.reportedTotal)
      const difference = calculated.minus(reportedCategory)
      if (!difference.isZero()) {
        warnings.push(
          warning(
            'CATEGORY_TOTAL_MISMATCH',
            `El subtotal de ${category.rawCategory} no coincide con la suma de sus tenencias.`,
            category.rawCategory,
          ),
        )
      }
      return {
        rawCategory: category.rawCategory,
        normalizedCategory: category.normalizedCategory,
        calculated: formatCalculated(calculated),
        reported: formatCalculated(reportedCategory),
        difference: formatCalculated(difference),
      }
    }),
  }
}

function readCashMention(block: string): RawCash | 'unknown' | null {
  const pesos = block.match(/(?:^|\s)pesos\s*(?:\|\s*)?\$\s*([\d.,]+)/i)
  const dollars = block.match(/(?:^|\s)d[oó]lares\s*(?:\|\s*)?usd\s*([\d.,]+)/i)
  const cable = block.match(/(?:^|\s)us dollar\s*\(cable\)\s*(?:\|\s*)?usd\s*([\d.,]+)/i)
  const matched = pesos?.[1]
    ? { currency: 'ARS' as const, raw: pesos[1] }
    : dollars?.[1]
      ? { currency: 'USD_MEP' as const, raw: dollars[1] }
      : cable?.[1]
        ? { currency: 'USD_CABLE' as const, raw: cable[1] }
        : null
  if (matched) {
    const amount = readScaledAmount(matched.raw)
    return amount ? { currency: matched.currency, amount, label: block } : null
  }
  if (/^(?:d[oó]lar(?:es)?|usd|pesos|us dollar)\b/i.test(block)) return 'unknown'
  return null
}

function readRate(block: string, pattern: RegExp): ScaledAmount | null {
  const match = block.match(pattern)
  if (!match?.[1]) return null
  return readScaledAmount(match[1])
}

function textBlocks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
}

function loneCategory(text: string): { raw: string; normalized: NormalizedHoldingCategory } | null {
  const normalized = normalizeCategory(text)
  if (!normalized || !/^(acciones|cedears|corporativos|fondos)$/i.test(text.trim())) return null
  return { raw: canonicalCategoryLabel(normalized), normalized }
}

function normalizeCategory(label: string): NormalizedHoldingCategory | null {
  if (/^acciones$/i.test(label.trim())) return 'STOCK'
  if (/^cedears$/i.test(label.trim())) return 'CEDEAR'
  if (/^corporativos$/i.test(label.trim())) return 'CORPORATE_BOND'
  if (/^fondos$/i.test(label.trim())) return 'FUND'
  return null
}

function canonicalCategoryLabel(category: NormalizedHoldingCategory): string {
  if (category === 'STOCK') return 'Acciones'
  if (category === 'CEDEAR') return 'Cedears'
  if (category === 'CORPORATE_BOND') return 'Corporativos'
  return 'Fondos'
}

function isIgnoredProse(text: string): boolean {
  return /^(?:balanz|full investment house)$/i.test(text)
    || /balanz capital|www\.balanz\.com/i.test(text)
    || /^posici[oó]n consolidada/i.test(text)
    || /^informaci[oó]n de cuenta/i.test(text)
    || /^instrumentos monedas$/i.test(text)
    || /^la informaci[oó]n detallada/i.test(text)
    || /evoluci[oó]n de cartera/i.test(text)
    || /mes en curso/i.test(text)
    || text.length > 240
}

function isPositionHeader(line: string): boolean {
  return /especie/i.test(line) && /valor actual/i.test(line) && line.includes('|')
}

function headerFromRow(row: PdfTextRow): ColumnMark[] | null {
  const columns = row.items.flatMap((item) => {
    const key = columnKey(item.text)
    return key ? [{ key, x: item.x }] : []
  })
  const keys = new Set(columns.map((column) => column.key))
  if (!keys.has('ticker') || !keys.has('marketValue')) return null
  return columns.sort((left, right) => left.x - right.x)
}

function columnKey(label: string): PositionColumn | null {
  const value = label
    .trim()
    .toLowerCase()
    .replaceAll('á', 'a')
    .replaceAll('é', 'e')
    .replaceAll('í', 'i')
    .replaceAll('ó', 'o')
    .replaceAll('ú', 'u')
    .replaceAll('.', '')
  if (value === 'especie') return 'ticker'
  if (value === 'descripcion') return 'name'
  if (value === 'cantidad') return 'quantity'
  if (value === 'garantia') return 'guarantee'
  if (value === 'precio') return 'price'
  if (value === 'valor actual') return 'marketValue'
  return null
}

function cellsFromRow(row: PdfTextRow, columns: readonly ColumnMark[]): Partial<Record<PositionColumn, string>> {
  const cells: Partial<Record<PositionColumn, string>> = {}
  for (const item of row.items) {
    const key = columnAt(item, columns)
    const previous = cells[key]
    cells[key] = previous ? `${previous} ${item.text}` : item.text
  }
  return cells
}

function columnAt(item: PdfTextItem, columns: readonly ColumnMark[]): PositionColumn {
  let found = columns[0]?.key ?? 'ticker'
  for (const column of columns) {
    if (item.x + 0.5 >= column.x) found = column.key
    else break
  }
  return found
}

function joinRow(row: PdfTextRow): string {
  return row.items.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim()
}

function stripCurrency(raw: string): string {
  return raw.trim().replace(/^(?:usd|\$)\s*/i, '')
}

function warning(code: ParserWarning['code'], message: string, sourceReference: string): ParserWarning {
  return { code, message, sourceReference }
}
