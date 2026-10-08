import Decimal from 'decimal.js'
import type { CurrencyCode } from '../../domain/currency'
import type { TransactionType } from '../../domain/transaction'
import { ParserError } from '../errors/parserErrors'
import type {
  NormalizedCorporateAction,
  NormalizedTransaction,
  ParsedFxOperation,
  ParsedMonthlyAccount,
  ParsedOperationGroup,
  ParsedOperationLeg,
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

type MovementKind = TransactionType | 'STOCK_DIVIDEND' | 'KNOWN_NON_ECONOMIC'

interface AnnotatedLine extends StatementLine {
  currency: CurrencyCode | null
  unknownCurrency: string | null
  sectionTicker: string | null
  openingQuantity: string | null
  sectionKind: 'INSTRUMENT' | 'CASH' | 'NONE'
}

interface LineGroup {
  reference: string | null
  lines: AnnotatedLine[]
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
  let sectionKind: AnnotatedLine['sectionKind'] = 'NONE'

  for (const line of lines) {
    const description = line.description.trim()
    if (description.length === 0) continue
    if (line.cells.tradeDate) {
      annotated.push({
        ...line,
        description,
        currency,
        unknownCurrency,
        sectionTicker,
        openingQuantity,
        sectionKind,
      })
      continue
    }
    if (isDocumentChrome(description)) continue

    const instrument = readInstrumentHeader(description)
    if (instrument) {
      sectionTicker = instrument
      sectionKind = 'INSTRUMENT'
      currency = null
      unknownCurrency = null
      openingQuantity = null
      continue
    }

    const section = readCurrencySection(description)
    if (section === 'unknown') {
      unknownCurrency = description
      currency = null
      sectionTicker = null
      sectionKind = 'CASH'
      openingQuantity = null
      continue
    }
    if (section) {
      currency = section
      unknownCurrency = null
      sectionTicker = null
      sectionKind = 'CASH'
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
      annotated.push({
        ...line,
        description,
        currency,
        unknownCurrency,
        sectionTicker,
        openingQuantity,
        sectionKind,
      })
    }
  }

  return annotated
}

function buildResult(period: ParsedMonthlyAccount['period'], lines: readonly AnnotatedLine[]): ParsedMonthlyAccount {
  const warnings: ParserWarning[] = []
  const transactions: NormalizedTransaction[] = []
  const corporateActions: NormalizedCorporateAction[] = []
  const operationGroups: ParsedOperationGroup[] = []

  for (const group of groupLines(lines)) {
    const only = group.lines.length === 1 ? group.lines[0] : null
    const outcome = only ? normalizeLine(only) : normalizeOperation(group)
    warnings.push(...outcome.warnings)
    if (outcome.transaction) transactions.push(outcome.transaction)
    if (outcome.corporateAction) corporateActions.push(outcome.corporateAction)
    operationGroups.push(toOperationGroup(group))
  }

  return {
    broker: 'BALANZ',
    documentType: 'MONTHLY_ACCOUNT',
    period,
    transactions,
    corporateActions,
    operationGroups,
    fxOperations: operationGroups
      .filter((group) => group.operationType === 'FX_CONVERSION')
      .map(toFxOperation),
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
  const kind = classify(description)
  if (kind === 'KNOWN_NON_ECONOMIC') {
    return { transaction: null, corporateAction: null, warnings }
  }
  const date = line.cells.tradeDate ? parseBalanzDate(line.cells.tradeDate) : null
  const ticker = fundMovement(kind) ? null : instrumentOf(line)

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
    if (kind !== 'UNKNOWN') {
      warnings.push(warning('MISSING_AMOUNT', 'El movimiento no tiene importe.', description))
    }
    return { transaction: null, corporateAction: null, warnings }
  }

  const currency = line.currency ?? quotedCurrency(description)
  if (!currency) {
    warnings.push(warning('UNKNOWN_CURRENCY', 'El movimiento no indica la moneda.', description))
    return { transaction: null, corporateAction: null, warnings }
  }

  if ((kind === 'BUY' || kind === 'SELL' || kind === 'DIVIDEND') && !ticker) {
    warnings.push(warning('MISSING_TICKER', 'El movimiento no indica el instrumento.', description))
  }

  const type: TransactionType = kind === 'UNKNOWN' ? 'OTHER' : kind
  const absoluteFlow =
    type === 'CONTRIBUTION' || type === 'WITHDRAWAL' || type === 'FUND_SUBSCRIPTION' || type === 'FUND_REDEMPTION'
  const quantity = kind === 'BUY' || kind === 'SELL' ? readNumber(line.cells.quantity) : null
  const unitPrice = kind === 'BUY' || kind === 'SELL' ? readNumber(line.cells.price) : null

  return {
    transaction: {
      date,
      type,
      ticker,
      quantity: quantity ? formatSignedQuantity(quantity) : null,
      unitPrice: unitPrice ? formatSignedMoney(unitPrice) : null,
      grossAmount: formatOptionalMoney(gross, absoluteFlow),
      netAmount: formatOptionalMoney(net, absoluteFlow),
      fees: formatOptionalMoney(sumCharges(line.cells.fee, line.cells.rights), true),
      taxes: formatOptionalMoney(sumCharges(line.cells.vatCharge, line.cells.vat), true),
      currency,
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
  if (
    /conversi[oó]n de moneda|operaci[oó]n de cambio|compra de d[oó]lares|venta de d[oó]lares/.test(text) ||
    /conversi[oó]n\s+cv\b/.test(text) ||
    /\bcv\s*[\d.]+\s+a\s+cv\b/.test(text) ||
    /\ba\s+cable\b/.test(text)
  ) {
    return 'FX_CONVERSION'
  }
  if (/transferencia a custodia\b/.test(text)) return 'KNOWN_NON_ECONOMIC'
  if (/liquidaci[oó]n de suscripci[oó]n|\bsuscripci[oó]n\b/.test(text)) return 'FUND_SUBSCRIPTION'
  if (/liquidaci[oó]n de rescate|\brescate\b/.test(text)) return 'FUND_REDEMPTION'
  if (/retenci[oó]n|\bimpuesto\b|\biigg\b|\bbbpp\b|bienes personales/.test(text)) return 'TAX'
  if (/comisi[oó]n/.test(text)) return 'FEE'
  if (/inter[eé]s|\brenta\b/.test(text)) return 'INTEREST'
  if (/dividendo/.test(text)) return 'DIVIDEND'
  if (/recibo de cobro/.test(text)) return 'CONTRIBUTION'
  if (/comprobante de pago/.test(text)) return 'WITHDRAWAL'
  if (/\bcompra\b/.test(text)) return 'BUY'
  if (/\bventa\b/.test(text)) return 'SELL'
  return 'UNKNOWN'
}

function groupLines(lines: readonly AnnotatedLine[]): LineGroup[] {
  const groups: LineGroup[] = []
  const indexByKey = new Map<string, number>()
  lines.forEach((line, index) => {
    const reference = explicitReference(line.description)
    const kind = classify(line.description)
    const key = reference?.key ?? (kind === 'FX_CONVERSION' ? fxKey(line) : `row:${index}`)
    const found = indexByKey.get(key)
    if (found === undefined) {
      indexByKey.set(key, groups.length)
      groups.push({ reference: reference?.id ?? null, lines: [line] })
      return
    }
    groups[found]?.lines.push(line)
  })
  return groups
}

function explicitReference(description: string): { id: string; key: string } | null {
  const match = description.match(
    /\b(boleto|suscripci[oó]n|rescate|recibo de cobro|comprobante de pago)\s*\/\s*(\d+)/i,
  )
  if (!match?.[1] || !match[2]) return null
  const kind = match[1]
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '-')
  return { id: match[2], key: `${kind}:${match[2]}` }
}

function fxKey(line: AnnotatedLine): string {
  const date = line.cells.tradeDate ? parseBalanzDate(line.cells.tradeDate) ?? line.cells.tradeDate : 'missing'
  const text = line.description.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
  return `fx:${text}:${date}`
}

function normalizeOperation(group: LineGroup): {
  transaction: NormalizedTransaction | null
  corporateAction: NormalizedCorporateAction | null
  warnings: ParserWarning[]
} {
  const warnings: ParserWarning[] = []
  const description = preferredDescription(group)
  const kind = classify(description)
  if (kind === 'KNOWN_NON_ECONOMIC') {
    return { transaction: null, corporateAction: null, warnings }
  }
  const dated =
    group.lines.find((line) => line.sectionKind === 'INSTRUMENT' && line.cells.tradeDate) ??
    group.lines.find((line) => line.cells.tradeDate)
  const date = dated?.cells.tradeDate ? parseBalanzDate(dated.cells.tradeDate) : null
  if (!date) {
    warnings.push(warning('MISSING_DATE', 'El movimiento no tiene una fecha válida.', description))
    return { transaction: null, corporateAction: null, warnings }
  }

  const first = group.lines[0]
  if (kind === 'STOCK_DIVIDEND') {
    if (!first) return { transaction: null, corporateAction: null, warnings }
    return normalizeStockDividend(first, date, instrumentOf(first), warnings)
  }

  const tradeLine =
    group.lines.find((line) => line.sectionKind === 'INSTRUMENT' && line.cells.quantity) ??
    group.lines.find((line) => line.sectionKind === 'INSTRUMENT' && line.cells.price) ??
    group.lines.find((line) => line.sectionKind === 'INSTRUMENT')
  const amountLine = chooseAmountLine(group, kind)
  const gross = readNumber(amountLine?.cells.gross)
  const net = readNumber(amountLine?.cells.net)
  if (gross === null && net === null) {
    warnings.push(warning('MISSING_AMOUNT', 'El movimiento no tiene importe.', description))
    return { transaction: null, corporateAction: null, warnings }
  }

  const currency = resolveCurrency(group, kind)
  if (!currency) {
    warnings.push(warning('UNKNOWN_CURRENCY', 'El movimiento no indica la moneda.', description))
    return { transaction: null, corporateAction: null, warnings }
  }

  const ticker = fundMovement(kind) ? null : tradeLine ? instrumentOf(tradeLine) : first ? instrumentOf(first) : null
  if ((kind === 'BUY' || kind === 'SELL' || kind === 'DIVIDEND') && !ticker) {
    warnings.push(warning('MISSING_TICKER', 'El movimiento no indica el instrumento.', description))
  }

  const type: TransactionType = kind === 'UNKNOWN' ? 'OTHER' : kind
  const absoluteFlow =
    type === 'CONTRIBUTION' || type === 'WITHDRAWAL' || type === 'FUND_SUBSCRIPTION' || type === 'FUND_REDEMPTION'
  const quantitySource =
    group.lines.find((line) => line.sectionKind === 'INSTRUMENT' && line.cells.quantity) ??
    group.lines.find((line) => line.cells.quantity)
  const quantity = kind === 'BUY' || kind === 'SELL' ? readNumber(quantitySource?.cells.quantity) : null
  const unitPrice = kind === 'BUY' || kind === 'SELL' ? readNumber(tradeLine?.cells.price) : null
  const feeLine = tradeLine ?? amountLine

  return {
    transaction: {
      date,
      type,
      ticker,
      quantity: quantity ? formatSignedQuantity(quantity) : null,
      unitPrice: unitPrice ? formatSignedMoney(unitPrice) : null,
      grossAmount: formatOptionalMoney(gross, absoluteFlow),
      netAmount: formatOptionalMoney(net, absoluteFlow),
      fees: formatOptionalMoney(sumCharges(feeLine?.cells.fee, feeLine?.cells.rights), true),
      taxes: formatOptionalMoney(sumCharges(feeLine?.cells.vatCharge, feeLine?.cells.vat), true),
      currency,
      fxRate: formatOptionalMoney(readNumber(amountLine?.cells.fxRate), false),
      sourceReference: description,
    },
    corporateAction: null,
    warnings,
  }
}

function chooseAmountLine(group: LineGroup, kind: MovementKind | 'UNKNOWN'): AnnotatedLine | null {
  const withMoney = (line: AnnotatedLine) => Boolean(line.cells.net || line.cells.gross)
  if (kind === 'BUY' || kind === 'SELL') {
    return (
      group.lines.find((line) => line.sectionKind === 'INSTRUMENT' && withMoney(line)) ??
      group.lines.find(withMoney) ??
      group.lines[0] ??
      null
    )
  }
  if (kind === 'FUND_SUBSCRIPTION' || kind === 'FUND_REDEMPTION' || kind === 'CONTRIBUTION' || kind === 'WITHDRAWAL') {
    return (
      group.lines.find((line) => line.currency === 'ARS' && withMoney(line)) ??
      group.lines.find(withMoney) ??
      group.lines[0] ??
      null
    )
  }
  if (kind === 'FX_CONVERSION') {
    return (
      group.lines.find((line) => withMoney(line) && readNumber(line.cells.net)?.isNegative()) ??
      group.lines.find(withMoney) ??
      group.lines[0] ??
      null
    )
  }
  return group.lines.find((line) => line.currency && withMoney(line)) ?? group.lines.find(withMoney) ?? group.lines[0] ?? null
}

function resolveCurrency(group: LineGroup, kind: MovementKind | 'UNKNOWN'): CurrencyCode | null {
  if (kind === 'BUY' || kind === 'SELL') {
    const instrument = group.lines.find((line) => line.sectionKind === 'INSTRUMENT')
    const quoted = quotedCurrency(instrument?.description ?? '')
    if (quoted) return quoted
    const foreign = uniqueCurrencies(
      group.lines.filter((line) => line.sectionKind === 'CASH' && line.currency && line.currency !== 'ARS'),
    )
    if (foreign.length === 1) return foreign[0] ?? null
    const cash = uniqueCurrencies(group.lines.filter((line) => line.currency))
    if (cash.length === 1) return cash[0] ?? null
    return null
  }
  const amount = chooseAmountLine(group, kind)
  if (amount?.currency) return amount.currency
  const currencies = uniqueCurrencies(group.lines.filter((line) => line.currency))
  return currencies.length === 1 ? currencies[0] ?? null : null
}

function quotedCurrency(description: string): CurrencyCode | null {
  if (/\/\s*\$\s*$/.test(description)) return 'ARS'
  if (/\/\s*(?:u\$s|usd)\s*cable\s*$/i.test(description)) return 'USD_CABLE'
  if (/\/\s*(?:u\$s|usd)\s*mep\s*$/i.test(description) || /\/\s*mep\s*$/i.test(description)) return 'USD_MEP'
  return null
}

function uniqueCurrencies(lines: readonly AnnotatedLine[]): CurrencyCode[] {
  const found: CurrencyCode[] = []
  for (const line of lines) {
    if (line.currency && !found.includes(line.currency)) found.push(line.currency)
  }
  return found
}

function preferredDescription(group: LineGroup): string {
  return group.lines.find((line) => line.sectionKind === 'INSTRUMENT')?.description ?? group.lines[0]?.description ?? ''
}

function fundMovement(kind: MovementKind | 'UNKNOWN'): boolean {
  return kind === 'FUND_SUBSCRIPTION' || kind === 'FUND_REDEMPTION'
}

function instrumentOf(line: AnnotatedLine): string | null {
  if (/suscripci|rescate/i.test(line.description)) return null
  return boletoTicker(line.description) ?? readMovementTicker(line.description) ?? line.sectionTicker
}

function boletoTicker(description: string): string | null {
  const match = description.match(/\/\s*([A-Z][A-Z0-9.]{1,14})\s*\/\s*(?:\$|u\$s|usd|mep|cable)\s*$/i)
  return match?.[1]?.toUpperCase() ?? null
}

function toOperationGroup(group: LineGroup): ParsedOperationGroup {
  const description = preferredDescription(group)
  const kind = classify(description)
  const instrumentLine = group.lines.find((line) => line.sectionKind === 'INSTRUMENT')
  const dateLine = instrumentLine?.cells.tradeDate ? instrumentLine : group.lines.find((line) => line.cells.tradeDate)
  const first = group.lines[0]
  return {
    operationReference: group.reference,
    operationType: kind === 'UNKNOWN' ? 'OTHER' : kind,
    instrument: instrumentLine ? instrumentOf(instrumentLine) : first ? instrumentOf(first) : null,
    date: dateLine?.cells.tradeDate ? parseBalanzDate(dateLine.cells.tradeDate) : null,
    settlementDate: dateLine?.cells.settlementDate ? parseBalanzDate(dateLine.cells.settlementDate) : null,
    legs: group.lines.map(toLeg),
  }
}

function toFxOperation(group: ParsedOperationGroup): ParsedFxOperation {
  return {
    operationReference: group.operationReference,
    date: group.date,
    settlementDate: group.settlementDate,
    legs: group.legs,
  }
}

function toLeg(line: AnnotatedLine): ParsedOperationLeg {
  const gross = readNumber(line.cells.gross)
  const net = readNumber(line.cells.net)
  const quantity = readNumber(line.cells.quantity)
  const price = readNumber(line.cells.price)
  return {
    section: line.sectionKind,
    currency: line.currency,
    quantity: quantity ? formatSignedQuantity(quantity) : null,
    price: price ? formatSignedMoney(price) : null,
    gross: gross ? formatSignedMoney(gross) : null,
    fees: formatOptionalMoney(sumCharges(line.cells.fee, line.cells.rights), true),
    taxes: formatOptionalMoney(sumCharges(line.cells.vatCharge, line.cells.vat), true),
    commission: formatOptionalMoney(readNumber(line.cells.fee), true),
    vat: formatOptionalMoney(readNumber(line.cells.vatCharge), true),
    marketFees: formatOptionalMoney(readNumber(line.cells.rights), true),
    taxComponent: formatOptionalMoney(readNumber(line.cells.vat), true),
    net: net ? formatSignedMoney(net) : null,
    date: line.cells.tradeDate ? parseBalanzDate(line.cells.tradeDate) : null,
    settlementDate: line.cells.settlementDate ? parseBalanzDate(line.cells.settlementDate) : null,
    rawDescription: line.description,
  }
}

function formatSignedQuantity(value: Decimal): string {
  const text = value.abs().toString()
  return value.isNegative() ? `-${text}` : text
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
