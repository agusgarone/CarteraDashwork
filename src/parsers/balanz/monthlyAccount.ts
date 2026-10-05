import Decimal from 'decimal.js'
import type { CurrencyCode } from '../../domain/currency'
import type { TransactionType } from '../../domain/transaction'
import { ParserError } from '../errors/parserErrors'
import type {
  NormalizedCorporateAction,
  NormalizedTransaction,
  ParsedMonthlyAccount,
  ParserWarning,
} from '../models/parsedMonthlyAccount'
import {
  formatMoney,
  formatQuantity,
  formatSignedMoney,
  parseArgentineNumber,
  parseBalanzDate,
} from '../text/argentinianFormat'
import { extractPdfDocument, type PdfTextDocument } from '../text/extractPdfText'
import {
  isDocumentChrome,
  isRunningBalance,
  readCurrencySection,
  readInstrumentHeader,
  readMovementTicker,
  statementLinesFromPdf,
  statementLinesFromText,
  type StatementLine,
} from './statementTable'

const MONTHLY_ACCOUNT_TITLE = /resumen mensual comitente|cuenta corriente por concertaci[oó]n/i
const PERIOD_RANGE =
  /(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})\s*(?:al|a|-)\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i

type MovementKind = TransactionType | 'STOCK_DIVIDEND'

interface AnnotatedLine extends StatementLine {
  currency: CurrencyCode | null
  unknownCurrency: string | null
  sectionTicker: string | null
  openingQuantity: string | null
}

/**
 * Lee un Resumen mensual comitente, que Balanz titula
 * "Cuenta Corriente por Concertación".
 * No calcula rendimiento, no persiste y no llama al PortfolioEngine.
 */
export function parseBalanzMonthlyAccountText(text: string): ParsedMonthlyAccount {
  assertMonthlyAccount(text)
  return buildResult(readPeriod(text), annotate(statementLinesFromText(text)))
}

export async function parseBalanzMonthlyAccountPdf(data: Uint8Array): Promise<ParsedMonthlyAccount> {
  const document = await extractPdfDocument(data)
  return parseBalanzMonthlyAccountDocument(document)
}

export function parseBalanzMonthlyAccountDocument(document: PdfTextDocument): ParsedMonthlyAccount {
  assertMonthlyAccount(document.text)
  return buildResult(readPeriod(document.text), annotate(statementLinesFromPdf(document)))
}

function assertMonthlyAccount(text: string): void {
  if (!MONTHLY_ACCOUNT_TITLE.test(text)) {
    throw new ParserError('El documento no es un Resumen mensual comitente.')
  }
}

function readPeriod(text: string): ParsedMonthlyAccount['period'] {
  const match = text.match(PERIOD_RANGE)
  const startDate = match ? parseBalanzDate(match[1]) : null
  const endDate = match ? parseBalanzDate(match[2]) : null
  if (!startDate || !endDate) {
    throw new ParserError('El resumen no indica el período con fechas de inicio y fin.')
  }
  return { startDate, endDate }
}

function annotate(lines: readonly StatementLine[]): AnnotatedLine[] {
  const annotated: AnnotatedLine[] = []
  let currency: CurrencyCode | null = null
  let unknownCurrency: string | null = null
  let sectionTicker: string | null = null
  let openingQuantity: string | null = null

  for (const line of lines) {
    const description = line.description.trim()
    if (description.length === 0) continue
    if (line.cells.tradeDate) {
      annotated.push({ ...line, description, currency, unknownCurrency, sectionTicker, openingQuantity })
      continue
    }
    if (isDocumentChrome(description)) continue

    const instrument = readInstrumentHeader(description)
    if (instrument) {
      sectionTicker = instrument
      openingQuantity = null
      continue
    }

    const section = readCurrencySection(description)
    if (section === 'unknown') {
      unknownCurrency = description
      currency = null
      sectionTicker = null
      openingQuantity = null
      continue
    }
    if (section) {
      currency = section
      unknownCurrency = null
      sectionTicker = null
      openingQuantity = null
      continue
    }

    if (isRunningBalance(description)) {
      if (/^saldo anterior\b/i.test(description) && line.cells.quantity) {
        openingQuantity = line.cells.quantity
      }
      continue
    }

    if (classify(description) !== 'UNKNOWN') {
      annotated.push({ ...line, description, currency, unknownCurrency, sectionTicker, openingQuantity })
    }
  }

  return annotated
}

function buildResult(period: ParsedMonthlyAccount['period'], lines: readonly AnnotatedLine[]): ParsedMonthlyAccount {
  const warnings: ParserWarning[] = []
  const transactions: NormalizedTransaction[] = []
  const corporateActions: NormalizedCorporateAction[] = []

  for (const line of lines) {
    const outcome = normalizeLine(line)
    warnings.push(...outcome.warnings)
    if (outcome.transaction) transactions.push(outcome.transaction)
    if (outcome.corporateAction) corporateActions.push(outcome.corporateAction)
  }

  return {
    broker: 'BALANZ',
    documentType: 'MONTHLY_ACCOUNT',
    period,
    transactions,
    corporateActions,
    warnings,
  }
}

function normalizeLine(line: AnnotatedLine): {
  transaction: NormalizedTransaction | null
  corporateAction: NormalizedCorporateAction | null
  warnings: ParserWarning[]
} {
  const warnings: ParserWarning[] = []
  const description = line.description
  const date = line.cells.tradeDate ? parseBalanzDate(line.cells.tradeDate) : null
  const ticker = readMovementTicker(description) ?? line.sectionTicker
  const kind = classify(description)

  if (!date) {
    warnings.push(warning('MISSING_DATE', 'El movimiento no tiene una fecha válida.', description))
    return { transaction: null, corporateAction: null, warnings }
  }

  if (kind === 'STOCK_DIVIDEND') {
    return normalizeStockDividend(line, date, ticker, warnings)
  }

  if (line.unknownCurrency) {
    warnings.push(warning('UNKNOWN_CURRENCY', 'La moneda del movimiento no está reconocida.', description))
    return { transaction: null, corporateAction: null, warnings }
  }

  if (kind === 'UNKNOWN') {
    warnings.push(warning('UNKNOWN_MOVEMENT', 'El movimiento no tiene una clasificación segura.', description))
  }

  const gross = readNumber(line.cells.gross)
  const net = readNumber(line.cells.net)
  if (gross === null && net === null) {
    warnings.push(warning('MISSING_AMOUNT', 'El movimiento no tiene importe.', description))
    return { transaction: null, corporateAction: null, warnings }
  }

  if (!line.currency) {
    warnings.push(warning('UNKNOWN_CURRENCY', 'El movimiento no indica la moneda.', description))
    return { transaction: null, corporateAction: null, warnings }
  }

  if ((kind === 'BUY' || kind === 'SELL' || kind === 'DIVIDEND') && !ticker) {
    warnings.push(warning('MISSING_TICKER', 'El movimiento no indica el instrumento.', description))
  }

  const type: TransactionType = kind === 'UNKNOWN' ? 'OTHER' : kind
  const absoluteFlow = type === 'CONTRIBUTION' || type === 'WITHDRAWAL'
  const quantity = kind === 'BUY' || kind === 'SELL' ? readNumber(line.cells.quantity) : null
  const unitPrice = kind === 'BUY' || kind === 'SELL' ? readNumber(line.cells.price) : null

  return {
    transaction: {
      date,
      type,
      ticker,
      quantity: quantity ? formatQuantity(quantity) : null,
      unitPrice: unitPrice ? formatSignedMoney(unitPrice) : null,
      grossAmount: formatOptionalMoney(gross, absoluteFlow),
      netAmount: formatOptionalMoney(net, absoluteFlow),
      fees: formatOptionalMoney(sumCharges(line.cells.fee, line.cells.rights), true),
      taxes: formatOptionalMoney(sumCharges(line.cells.vatCharge, line.cells.vat), true),
      currency: line.currency,
      fxRate: formatOptionalMoney(readNumber(line.cells.fxRate), false),
      sourceReference: description,
    },
    corporateAction: null,
    warnings,
  }
}

function normalizeStockDividend(
  line: AnnotatedLine,
  date: string,
  ticker: string | null,
  warnings: ParserWarning[],
): {
  transaction: null
  corporateAction: NormalizedCorporateAction | null
  warnings: ParserWarning[]
} {
  if (!ticker) {
    warnings.push(warning('MISSING_TICKER', 'El dividendo en acciones no indica el instrumento.', line.description))
    return { transaction: null, corporateAction: null, warnings }
  }

  const quantity = readNumber(line.cells.quantity)
  if (!quantity) {
    warnings.push(warning('MISSING_AMOUNT', 'El dividendo en acciones no indica la cantidad.', line.description))
    return { transaction: null, corporateAction: null, warnings }
  }

  const opening = readNumber(line.openingQuantity)
  const closing = readNumber(line.cells.balance)
  return {
    transaction: null,
    corporateAction: {
      date,
      type: 'STOCK_DIVIDEND',
      ticker,
      quantityBefore: opening ? formatQuantity(opening) : null,
      quantityChange: formatQuantity(quantity),
      quantityAfter: closing ? formatQuantity(closing) : null,
      ratio: null,
      description: line.description,
      sourceReference: line.description,
    },
    warnings,
  }
}

function classify(description: string): MovementKind | 'UNKNOWN' {
  const text = description.toLowerCase()
  if (/dividendo en acciones|dividendo en especie|renta en especie/.test(text)) return 'STOCK_DIVIDEND'
  if (/conversi[oó]n de moneda|operaci[oó]n de cambio|compra de d[oó]lares|venta de d[oó]lares/.test(text)) {
    return 'FX_CONVERSION'
  }
  if (/retenci[oó]n|\bimpuesto\b|\biigg\b|\bbbpp\b|bienes personales/.test(text)) return 'TAX'
  if (/comisi[oó]n/.test(text)) return 'FEE'
  if (/inter[eé]s/.test(text)) return 'INTEREST'
  if (/dividendo/.test(text)) return 'DIVIDEND'
  if (/recibo de cobro/.test(text)) return 'CONTRIBUTION'
  if (/comprobante de pago/.test(text)) return 'WITHDRAWAL'
  if (/\bcompra\b/.test(text)) return 'BUY'
  if (/\bventa\b/.test(text)) return 'SELL'
  return 'UNKNOWN'
}

function readNumber(raw: string | null | undefined): Decimal | null {
  if (!raw) return null
  return parseArgentineNumber(raw)
}

function sumCharges(left: string | undefined, right: string | undefined): Decimal | null {
  const values = [readNumber(left), readNumber(right)].filter((value): value is Decimal => value !== null)
  if (values.length === 0) return null
  return values.reduce((total, value) => total.plus(value), new Decimal(0))
}

function formatOptionalMoney(value: Decimal | null, absolute: boolean): string | null {
  if (value === null) return null
  return absolute ? formatMoney(value) : formatSignedMoney(value)
}

function warning(code: ParserWarning['code'], message: string, sourceReference: string): ParserWarning {
  return { code, message, sourceReference }
}
