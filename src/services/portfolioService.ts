/**
 * Datos ilustrativos que ya no alimentan ninguna pantalla.
 * Resumen y Detalle leen SQLite. Este módulo queda solo como referencia del diseño anterior.
 */
import {
  LAST_LOADED_LABEL,
  LAST_LOADED_MONTH_ID,
  NEXT_IMPORT_LABEL,
  augustBreakdown,
  cashBalances,
  categoryColors,
  categorySeeds,
  instruments as instrumentRows,
  latestCategoryPeriodResults,
  months,
} from '@/mocks/portfolio'
import { transactions } from '@/mocks/transactions'
import type {
  Category,
  EvolutionPoint,
  Instrument,
  InstrumentResultOrigin,
  MonthSnapshot,
  PerformanceBreakdown,
  Period,
  PeriodSelection,
  PortfolioPeriodSummary,
  PortfolioSnapshot,
} from '@/types/portfolio'
import type { Transaction, TransactionType } from '@/types/transaction'

const LATEST_TOTAL = 26_383_988

export interface ResolvedPeriod {
  preset: PeriodSelection['preset']
  startMonthId: string
  endMonthId: string
  label: string
  startDate: string
  endDate: string
  months: MonthSnapshot[]
  missingLabels: string[]
}

export interface DashboardSummary {
  periodLabel: string
  patrimony: number
  patrimonyChange: number
  investedCapital: number
  netContributions: number
  investmentResult: number
  returnPercentage: number
  summary: PortfolioPeriodSummary
  breakdown: PerformanceBreakdown
  categories: Category[]
  missingLabels: string[]
}

const emptyBreakdown: PerformanceBreakdown = {
  marketChange: 0,
  dividends: 0,
  interest: 0,
  fees: 0,
  taxes: 0,
  other: 0,
}

function monthIndex(id: string) {
  return months.findIndex((month) => month.id === id)
}

function sliceMonths(startMonthId: string, endMonthId: string) {
  const start = monthIndex(startMonthId)
  const end = monthIndex(endMonthId)
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  return months.slice(from, to + 1)
}

function presetRange(preset: PeriodSelection['preset']): { startMonthId: string; endMonthId: string } {
  const endMonthId = LAST_LOADED_MONTH_ID
  const endIndex = monthIndex(endMonthId)
  if (preset === 'now') return { startMonthId: endMonthId, endMonthId }
  if (preset === '3m') return { startMonthId: months[Math.max(0, endIndex - 2)].id, endMonthId }
  if (preset === '6m') return { startMonthId: months[Math.max(0, endIndex - 5)].id, endMonthId }
  if (preset === 'ytd') return { startMonthId: '2026-01', endMonthId }
  return { startMonthId: months[0].id, endMonthId }
}

export function resolvePeriod(selection: PeriodSelection): ResolvedPeriod {
  const range =
    selection.preset === 'custom'
      ? { startMonthId: selection.startMonthId, endMonthId: selection.endMonthId }
      : presetRange(selection.preset)
  const rangeMonths = sliceMonths(range.startMonthId, range.endMonthId)
  const complete = rangeMonths.filter((month) => month.status === 'complete')
  const last = complete[complete.length - 1]
  const orderedStart = rangeMonths[0]
  const orderedEnd = rangeMonths[rangeMonths.length - 1]

  let label = `${orderedStart?.label ?? ''} – ${orderedEnd?.label ?? ''}`
  if (selection.preset === 'now' && last) {
    const previous = months[monthIndex(last.id) - 1]
    label = previous ? `${last.label} vs ${previous.label}` : last.label
  }

  return {
    preset: selection.preset,
    startMonthId: orderedStart?.id ?? range.startMonthId,
    endMonthId: orderedEnd?.id ?? range.endMonthId,
    label,
    startDate: orderedStart?.startDate ?? '',
    endDate: orderedEnd?.endDate ?? '',
    months: rangeMonths,
    missingLabels: rangeMonths
      .filter((month) => month.status === 'missing')
      .map((month) => month.label),
  }
}

function sumBreakdown(items: PerformanceBreakdown[]): PerformanceBreakdown {
  return items.reduce(
    (total, item) => ({
      marketChange: total.marketChange + item.marketChange,
      dividends: total.dividends + item.dividends,
      interest: total.interest + item.interest,
      fees: total.fees + item.fees,
      taxes: total.taxes + item.taxes,
      other: total.other + item.other,
    }),
    { ...emptyBreakdown },
  )
}

function allocateResult(result: number): PerformanceBreakdown {
  const dividends = Math.max(0, Math.round(result * 0.18))
  const interest = Math.max(0, Math.round(result * 0.16))
  const fees = Math.round(Math.abs(result) * 0.03)
  const taxes = Math.round(Math.abs(result) * 0.04)
  const marketChange = result - dividends - interest + fees + taxes
  return { marketChange, dividends, interest, fees, taxes: taxes, other: 0 }
}

function breakdownForMonth(month: MonthSnapshot): PerformanceBreakdown {
  if (month.status !== 'complete' || month.investmentResult === null) return emptyBreakdown
  if (month.id === LAST_LOADED_MONTH_ID) return augustBreakdown
  return allocateResult(month.investmentResult)
}

function summarize(period: ResolvedPeriod): PortfolioPeriodSummary {
  const complete = period.months.filter((month) => month.status === 'complete')
  const first = complete[0]
  const last = complete[complete.length - 1]
  const contributions = complete.reduce((sum, month) => sum + (month.contributions ?? 0), 0)
  const withdrawals = complete.reduce((sum, month) => sum + (month.withdrawals ?? 0), 0)
  const netContributions = contributions - withdrawals
  const investmentResult = complete.reduce((sum, month) => sum + (month.investmentResult ?? 0), 0)
  const startValue = first?.startValue ?? 0
  const endValue = last?.endValue ?? 0
  const explained = startValue + netContributions + investmentResult

  return {
    startValue,
    endValue,
    contributions,
    withdrawals,
    netContributions,
    investmentResult,
    returnPercentage: startValue === 0 ? 0 : investmentResult / startValue,
    unexplainedDifference: endValue - explained,
  }
}

function isLatestMonthOnly(period: ResolvedPeriod) {
  const complete = period.months.filter((month) => month.status === 'complete')
  return complete.length === 1 && complete[0]?.id === LAST_LOADED_MONTH_ID
}

function categoryPeriodResults(period: ResolvedPeriod, investmentResult: number) {
  if (isLatestMonthOnly(period)) return latestCategoryPeriodResults

  const cedears = Math.round(investmentResult * 0.55)
  const on = Math.round(investmentResult * 0.22)
  const fci = Math.round(investmentResult * 0.08)
  const acciones = Math.round(investmentResult * 0.12)
  return {
    cedears,
    on,
    fci,
    acciones,
    liquidez: investmentResult - cedears - on - fci - acciones,
  }
}

function scaleFactor(endValue: number) {
  return endValue / LATEST_TOTAL
}

export function getAvailablePeriods(): Period[] {
  return months.map((month) => ({
    id: month.id,
    label: month.label,
    startDate: month.startDate,
    endDate: month.endDate,
  }))
}

export function getLastLoadLabel() {
  return LAST_LOADED_LABEL
}

export function getNextImportLabel() {
  return NEXT_IMPORT_LABEL
}

export function getPortfolioSummary(selection: PeriodSelection): DashboardSummary {
  const period = resolvePeriod(selection)
  const summary = summarize(period)
  const breakdown = sumBreakdown(period.months.map(breakdownForMonth))
  const factor = scaleFactor(summary.endValue)
  const periodResults = categoryPeriodResults(period, summary.investmentResult)

  const categories: Category[] = categorySeeds.map((seed) => {
    const currentValue = Math.round(seed.currentValue * factor)
    const investedCapital = Math.round(seed.investedCapital * factor)
    const result = currentValue - investedCapital
    return {
      id: seed.id,
      name: seed.name,
      currentValue,
      investedCapital,
      result,
      returnPercentage: investedCapital === 0 ? 0 : result / investedCapital,
      weight: summary.endValue === 0 ? 0 : currentValue / summary.endValue,
      periodResult: periodResults[seed.id] ?? 0,
    }
  })

  return {
    periodLabel: period.label,
    patrimony: summary.endValue,
    patrimonyChange: summary.endValue - summary.startValue,
    investedCapital: investedCapitalAtEnd(period),
    netContributions: summary.netContributions,
    investmentResult: summary.investmentResult,
    returnPercentage: summary.returnPercentage,
    summary,
    breakdown,
    categories,
    missingLabels: period.missingLabels,
  }
}

function investedCapitalAtEnd(period: ResolvedPeriod) {
  const complete = period.months.filter((month) => month.status === 'complete')
  const last = complete[complete.length - 1]
  return last?.investedCapitalEnd ?? 0
}

export function getPortfolioEvolution(selection: PeriodSelection): EvolutionPoint[] {
  const period = resolvePeriod(selection)
  const complete = period.months.filter((month) => month.status === 'complete')
  const first = complete[0]
  const points: EvolutionPoint[] = []

  if (first && first.startValue !== null && first.investedCapitalEnd !== null && first.netContributions !== null) {
    points.push({
      id: `${first.id}-start`,
      label: 'Inicio',
      totalValue: first.startValue,
      investedCapital: first.investedCapitalEnd - first.netContributions,
    })
  }

  for (const month of period.months) {
    points.push({
      id: month.id,
      label: month.shortLabel,
      totalValue: month.endValue,
      investedCapital: month.investedCapitalEnd,
    })
  }

  return points
}

export function getPortfolioSnapshot(selection: PeriodSelection): PortfolioSnapshot {
  const summary = getPortfolioSummary(selection)
  return {
    date: resolvePeriod(selection).endDate,
    totalValue: summary.patrimony,
    investedCapital: summary.investedCapital,
    categories: summary.categories,
    cashBalances,
  }
}

export function getCategories(selection: PeriodSelection) {
  return getPortfolioSummary(selection).categories
}

export function getCategoryDetail(categoryId: string, selection: PeriodSelection) {
  const category = getCategories(selection).find((item) => item.id === categoryId) ?? null
  return {
    category,
    instruments: getInstruments(categoryId, selection),
  }
}

function periodIncludesLatest(period: ResolvedPeriod) {
  return period.months.some((month) => month.id === LAST_LOADED_MONTH_ID && month.status === 'complete')
}

export function getInstruments(categoryId: string, selection: PeriodSelection): Instrument[] {
  const period = resolvePeriod(selection)
  const summary = summarize(period)
  const factor = scaleFactor(summary.endValue)
  const includeIncome = periodIncludesLatest(period)

  return instrumentRows
    .filter((instrument) => instrument.categoryId === categoryId)
    .map((instrument) => {
      const currentValue = Math.round(instrument.currentValue * factor)
      const investedCapital = Math.round(instrument.investedCapital * factor)
      const result = currentValue - investedCapital
      return {
        ...instrument,
        currentValue,
        investedCapital,
        result,
        returnPercentage: investedCapital === 0 ? 0 : result / investedCapital,
        income: includeIncome ? instrument.income : null,
      }
    })
}

const incomeTypes = new Set<TransactionType>(['dividend', 'interest'])

export function getInstrumentDetail(instrumentId: string, selection: PeriodSelection) {
  const period = resolvePeriod(selection)
  const instrument =
    getInstruments(
      instrumentRows.find((item) => item.id === instrumentId)?.categoryId ?? '',
      selection,
    ).find((item) => item.id === instrumentId) ?? null

  if (!instrument) {
    return null
  }

  const related = transactions
    .filter((transaction) => transaction.instrumentId === instrumentId)
    .sort((a, b) => a.date.localeCompare(b.date))

  const periodTransactions = related.filter(
    (transaction) => transaction.date >= period.startDate && transaction.date <= period.endDate,
  )

  const origin = resultOrigin(instrument, periodTransactions)

  return {
    instrument,
    origin,
    periodTransactions: periodTransactions.filter((transaction) => !incomeTypes.has(transaction.type)),
    allTransactions: related.filter((transaction) => !incomeTypes.has(transaction.type)),
  }
}

function resultOrigin(instrument: Instrument, periodTransactions: Transaction[]): InstrumentResultOrigin {
  const dividends = periodTransactions
    .filter((transaction) => transaction.type === 'dividend')
    .reduce((sum, transaction) => sum + (transaction.netAmount ?? 0), 0)
  const interest = periodTransactions
    .filter((transaction) => transaction.type === 'interest')
    .reduce((sum, transaction) => sum + (transaction.netAmount ?? 0), 0)
  const feesAndTaxes = periodTransactions.reduce(
    (sum, transaction) => sum + transaction.fees + transaction.taxes,
    0,
  )
  const incomeFallback = instrument.income ?? 0
  const isEquity = instrument.categoryId === 'cedears' || instrument.categoryId === 'acciones'
  const isIncomeFund = instrument.categoryId === 'on' || instrument.categoryId === 'fci'

  return {
    marketChange: instrument.result,
    dividends: dividends || (isEquity ? incomeFallback : 0),
    interest: interest || (isIncomeFund ? incomeFallback : 0),
    feesAndTaxes,
  }
}

export function getMonthHistory() {
  return [...months].reverse()
}

export function getCategoryColor(categoryId: string) {
  return categoryColors[categoryId] ?? '#C5C8CE'
}

export const portfolioService = {
  getAvailablePeriods,
  getLastLoadLabel,
  getPortfolioSummary,
  getPortfolioEvolution,
  getPortfolioSnapshot,
  getCategories,
  getCategoryDetail,
  getInstruments,
  getInstrumentDetail,
  getMonthHistory,
  resolvePeriod,
}
