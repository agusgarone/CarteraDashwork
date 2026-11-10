import { hasKnownFundDenomination, resolveFundDenomination, type FundDenominationResolution } from '../../identity/fundDenominationAliases'
import type { Instrument } from '../../domain/instrument'
import Decimal from 'decimal.js'
import type { ParsedPosition } from '../../parsers/models/parsedConsolidatedPosition'
import type { NormalizedTransaction, ParsedMonthlyAccount } from '../../parsers/models/parsedMonthlyAccount'
import type {
  ParsedFundStatement,
  ParsedFundStatementRow,
  ParsedMonthlyFundStatement,
} from '../../parsers/models/parsedMonthlyFundStatement'
import {
  fundClassKeyFromConsolidatedName,
  fundClassKeyFromStatement,
  fundMatchKeyFromConsolidatedName,
  fundMatchKeyFromStatement,
} from '../fundIdentity'
import { ImportPeriodValidationError } from '../importPeriodErrors'

interface FundCandidate {
  fund: ParsedFundStatement
  row: ParsedFundStatementRow
  ticker: string
  denominations?: FundDenominationResolution[]
}

/**
 * La suscripción económica sale del resumen de fondos: cantidad, valor de cuota e importe.
 * El resumen mensual aporta la referencia de liquidación y la pata de caja.
 * No se persiste otra suscripción por esa pata.
 */
export function enrichFundSubscriptions(input: {
  account: ParsedMonthlyAccount
  fundStatement: ParsedMonthlyFundStatement
  positions: readonly ParsedPosition[]
  knownFunds?: readonly Instrument[]
}): ParsedMonthlyAccount {
  const candidates = fundCandidates(input.fundStatement, input.positions, input.account, input.knownFunds ?? [])
  const used = new Set<number>()
  const transactions: NormalizedTransaction[] = []

  for (const transaction of input.account.transactions) {
    if (transaction.type !== 'FUND_SUBSCRIPTION' && transaction.type !== 'FUND_REDEMPTION') {
      transactions.push(transaction)
      continue
    }
    const index = matchCandidate(transaction, candidates, used)
    if (index < 0) continue
    const candidate = candidates[index]
    if (!candidate) continue
    used.add(index)
    transactions.push(applyCandidate(transaction, candidate))
  }

  candidates.forEach((candidate, index) => {
    if (!used.has(index)) transactions.push(transactionFromCandidate(candidate))
  })

  return { ...input.account, transactions }
}

function fundCandidates(
  fundStatement: ParsedMonthlyFundStatement,
  positions: readonly ParsedPosition[],
  account: ParsedMonthlyAccount,
  knownFunds: readonly Instrument[],
): FundCandidate[] {
  const candidates: FundCandidate[] = []
  for (const fund of fundStatement.funds) {
    const denomination = denominationCandidate(fund, account, knownFunds)
    for (const row of fund.rows) {
      if (row.type !== 'SUBSCRIPTION' && row.type !== 'REDEMPTION') continue
      const ticker = denomination?.ticker ?? tickerForFund(fund, positions) ?? tickerFromKnownFund(fund, knownFunds) ?? tickerFromAccount(fund, account, knownFunds)
      if (!ticker) {
        throw new ImportPeriodValidationError(`No hay una identidad inequívoca de fondos para ${fund.fundName}.`)
      }
      candidates.push({ fund, row, ticker, denominations: denomination?.denominations })
    }
  }
  return candidates
}

function denominationCandidate(
  fund: ParsedFundStatement,
  account: ParsedMonthlyAccount,
  knownFunds: readonly Instrument[],
): { ticker: string; denominations: FundDenominationResolution[] } | null {
  const resolution = resolveFundDenomination(
    fund.fundName,
    fund.shareClass,
    fund.currency,
  )
  if (!resolution) {
    if (hasKnownFundDenomination(fund.fundName, fund.shareClass))
      throw new ImportPeriodValidationError(
        'La moneda del alias del fondo no coincide con su identidad documental.',
      )
    return null
  }
  if (
    knownFunds.some(
      (instrument) =>
        instrument.category === 'FUND' &&
        resolution.brokerCodes.includes(instrument.ticker) &&
        instrument.currency !== fund.currency,
    )
  ) {
    throw new ImportPeriodValidationError(
      'La moneda guardada para el código del fondo contradice el alias documentado.',
    )
  }
  const known = knownFunds.filter(
    (instrument) =>
      instrument.category === 'FUND' &&
      instrument.currency === fund.currency &&
      (resolution.brokerCodes.includes(instrument.ticker) ||
        resolveFundDenomination(
          instrument.name ?? '',
          fund.shareClass,
          instrument.currency,
        )?.canonicalIdentity === resolution.canonicalIdentity),
  )
  if (known.length > 1)
    throw new ImportPeriodValidationError(
      'Hay más de un instrumento para la identidad del fondo ' +
        resolution.canonicalIdentity +
        '.',
    )
  const headers = (account.fundInstruments ?? []).filter(
    (instrument) =>
      instrument.shareClass === resolution.shareClass &&
      resolveFundDenomination(
        instrument.name,
        instrument.shareClass,
        fund.currency,
      )?.canonicalIdentity === resolution.canonicalIdentity,
  )
  if (headers.some((header) => !resolution.brokerCodes.includes(header.ticker)))
    throw new ImportPeriodValidationError(
      'El código del fondo no coincide con el alias documentado.',
    )
  const ticker = known[0]?.ticker ?? resolution.brokerCodes[0]
  if (!ticker)
    throw new ImportPeriodValidationError(
      'Falta un código documental para la clase del fondo ' +
        resolution.canonicalIdentity +
        '.',
    )
  return {
    ticker,
    denominations: [
      resolution,
      ...headers.flatMap((header) => {
        const raw = resolveFundDenomination(
          header.name,
          header.shareClass,
          fund.currency,
        )
        return raw ? [raw] : []
      }),
    ],
  }
}

function tickerForFund(fund: ParsedFundStatement, positions: readonly ParsedPosition[]): string | null {
  const matchKey = fundMatchKeyFromStatement(fund)
  const classKey = fundClassKeyFromStatement(fund)
  const matches = positions.filter((position) => {
    if (position.normalizedCategory !== 'FUND') return false
    if (matchKey && fundMatchKeyFromConsolidatedName(position.name, fund.currency) === matchKey) return true
    if (classKey && fundClassKeyFromConsolidatedName(position.name) === classKey) return true
    return false
  })
  if (matches.length > 1) throw new ImportPeriodValidationError(`Hay más de una identidad de fondos para ${fund.fundName}.`)
  if (matches.length === 0) return null
  return matches[0]?.ticker ?? null
}

function tickerFromKnownFund(fund: ParsedFundStatement, instruments: readonly Instrument[]): string | null {
  const key = fundMatchKeyFromStatement(fund)
  const matches = instruments.filter(instrument => instrument.category === 'FUND' && instrument.currency === fund.currency && (
    (key !== null && fundMatchKeyFromConsolidatedName(instrument.name ?? '', instrument.currency) === key) ||
    fold(instrument.name ?? '') === fold(fund.fundName + ' - Clase ' + fund.shareClass)
  ))
  if (matches.length > 1) throw new ImportPeriodValidationError('Hay más de una identidad guardada para ' + fund.fundName + '.')
  return matches[0]?.ticker ?? null
}

function tickerFromAccount(fund: ParsedFundStatement, account: ParsedMonthlyAccount, knownFunds: readonly Instrument[]): string | null {
  const shareClass = fund.shareClass
  if (!shareClass) return null
  const name = fold(fund.fundName.replace(/\s+FCI(?:\s*\([^)]*\))?\s*$/i, ''))
  const matches = account.fundInstruments?.filter(instrument =>
    instrument.shareClass === shareClass && fold(instrument.name.replace(/\s+clase\s+([A-Za-z0-9]+)\s*$/i, ' $1')) === name + ' ' + fold(shareClass),
  ) ?? []
  const tickers = [...new Set(matches.map(instrument => instrument.ticker))]
  if (tickers.length !== 1) return null
  const ticker = tickers[0]!
  const existing = knownFunds.filter(instrument => instrument.category === 'FUND' && instrument.ticker.replace(/\s/g, '') === ticker.replace(/\s/g, ''))
  if (existing.length > 1) throw new ImportPeriodValidationError('Hay más de un código guardado para el fondo ' + fund.fundName + '.')
  return existing[0]?.ticker ?? ticker
}

function identity(candidate: FundCandidate): NormalizedTransaction['fundIdentity'] {
  if (!candidate.fund.shareClass) return undefined
  return { name: candidate.denominations?.[0]?.canonicalName ?? candidate.fund.fundName, shareClass: candidate.fund.shareClass, brokerCode: candidate.ticker, ...(candidate.denominations ? { denominations: candidate.denominations } : {}) }
}

function matchCandidate(
  transaction: NormalizedTransaction,
  candidates: readonly FundCandidate[],
  used: ReadonlySet<number>,
): number {
  const available = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter((item) => !used.has(item.index) && sameDirection(transaction, item.candidate.row) && transaction.currency === item.candidate.fund.currency)
  const byAmount = available.filter((item) => amountsClose(transaction, item.candidate.row))
  if (byAmount.length === 1) return byAmount[0]?.index ?? -1
  const pool = byAmount.length > 0 ? byAmount : available
  const named = pool.filter((item) => mentionsFund(transaction.sourceReference, item.candidate.fund))
  if (named.length === 1) return named[0]?.index ?? -1
  return -1
}

function sameDirection(transaction: NormalizedTransaction, row: ParsedFundStatementRow): boolean {
  if (transaction.type === 'FUND_SUBSCRIPTION') return row.type === 'SUBSCRIPTION'
  if (transaction.type === 'FUND_REDEMPTION') return row.type === 'REDEMPTION'
  return false
}

function amountsClose(transaction: NormalizedTransaction, row: ParsedFundStatementRow): boolean {
  if (!row.amount) return false
  const net = new Decimal(transaction.netAmount ?? transaction.grossAmount ?? 'NaN').abs()
  const amount = new Decimal(row.amount).abs()
  if (!net.isFinite() || !amount.isFinite()) return false
  return net.minus(amount).abs().lte(1)
}

function mentionsFund(description: string, fund: ParsedFundStatement): boolean {
  const text = fold(description)
  const fundName = fold(fund.fundName)
  if (fundName.length > 0 && text.includes(fundName)) return true
  const category = fold(fund.categoryName)
  return category.length > 4 && text.includes(category)
}

function applyCandidate(transaction: NormalizedTransaction, candidate: FundCandidate): NormalizedTransaction {
  return {
    ...transaction,
    date: candidate.row.date,
    ticker: candidate.ticker,
    fundIdentity: identity(candidate),
    quantity: candidate.row.quantity ?? transaction.quantity,
    unitPrice: candidate.row.unitValue ?? transaction.unitPrice,
    grossAmount: candidate.row.amount ?? transaction.grossAmount,
    netAmount: candidate.row.amount ?? transaction.netAmount,
    currency: candidate.fund.currency,
  }
}

function transactionFromCandidate(candidate: FundCandidate): NormalizedTransaction {
  return {
    date: candidate.row.date,
    type: candidate.row.type === 'REDEMPTION' ? 'FUND_REDEMPTION' : 'FUND_SUBSCRIPTION',
    ticker: candidate.ticker,
    fundIdentity: identity(candidate),
    sourceDocumentType: 'MONTHLY_FUND_STATEMENT',
    quantity: candidate.row.quantity,
    unitPrice: candidate.row.unitValue,
    grossAmount: candidate.row.amount,
    netAmount: candidate.row.amount,
    fees: null,
    taxes: null,
    currency: candidate.fund.currency,
    fxRate: null,
    sourceReference: candidate.row.sourceReference,
  }
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
