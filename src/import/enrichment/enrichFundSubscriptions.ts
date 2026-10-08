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
}): ParsedMonthlyAccount {
  const candidates = fundCandidates(input.fundStatement, input.positions)
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
): FundCandidate[] {
  const candidates: FundCandidate[] = []
  for (const fund of fundStatement.funds) {
    for (const row of fund.rows) {
      if (row.type !== 'SUBSCRIPTION' && row.type !== 'REDEMPTION') continue
      const ticker = tickerForFund(fund, positions)
      if (!ticker) {
        throw new ImportPeriodValidationError(`No hay una posición de fondos para ${fund.fundName}.`)
      }
      candidates.push({ fund, row, ticker })
    }
  }
  return candidates
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
  if (matches.length !== 1) return null
  return matches[0]?.ticker ?? null
}

function matchCandidate(
  transaction: NormalizedTransaction,
  candidates: readonly FundCandidate[],
  used: ReadonlySet<number>,
): number {
  const available = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter((item) => !used.has(item.index) && sameDirection(transaction, item.candidate.row))
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
