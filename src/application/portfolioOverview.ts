import type { DatabaseClient } from '../database/client'
import type { EntityId } from '../domain/common'
import type { PortfolioDocument } from '../domain/document'
import type { InstrumentCategory } from '../domain/instrument'
import type { PortfolioPeriod } from '../domain/period'
import type { ReconciliationRun, ReconciliationStatus } from '../domain/reconciliation'
import type { CashBalance, PortfolioSnapshot, Position } from '../domain/snapshot'
import { calculateNetContributions } from '../engine/calculations/investmentResult'
import { formatExact, formatMonetary, parseDecimal } from '../engine/money'
import type { PeriodPerformanceAnalysis } from '../engine/models/periodPerformance'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createPeriodAnalysisService, periodStartDate } from '../engine/services/periodAnalysisService'
import { ENGINE_VERSION } from '../engine/version'
import { reconciliationStatus } from '../import/reconciliationPolicy'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createDocumentRepository } from '../repositories/documentRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createReconciliationRepository } from '../repositories/reconciliationRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { resolveOverviewPeriod } from './overviewPeriod'

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const

const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const

const CATEGORY_LABEL: Record<InstrumentCategory | 'CASH', string> = {
  STOCK: 'Acciones',
  CEDEAR: 'CEDEARs',
  CORPORATE_BOND: 'Obligaciones negociables',
  BOND: 'Bonos',
  FUND: 'Fondos',
  OTHER: 'Otros',
  CASH: 'Liquidez',
}

export interface AllocationItem {
  id: InstrumentCategory | 'CASH'
  label: string
  marketValue: string
  /** Participación sobre el patrimonio informado. No es un rendimiento. */
  weight: string
}

export interface PortfolioEvolutionPoint {
  id: string
  label: string
  date: string
  portfolioValue: string
}

export interface OverviewMonth {
  periodId: string
  label: string
  closingValue: string | null
  netContributions: string | null
  investmentResult: string | null
}

export interface OverviewImportDocument {
  id: 'opening_position' | 'closing_position' | 'monthly_account' | 'fund_statement'
  label: string
  present: boolean
}

/**
 * Vista del Resumen.
 * Los importes siguen siendo DecimalString.
 * historicalContributedCapital queda null hasta tener los aportes anteriores
 * al primer snapshot: la card no debe mostrar el aporte de un solo mes
 * como si fuera el capital desde el inicio.
 */
export interface PortfolioOverviewView {
  period: {
    id: string
    year: number
    month: number
    label: string
    status: string
  }
  availablePeriods: { id: string; year: number; month: number; label: string }[]
  metrics: {
    currentPortfolioValue: string
    openingPortfolioValue: string | null
    portfolioValueChange: string | null
    contributions: string | null
    withdrawals: string | null
    netContributions: string | null
    investmentResult: string | null
    explainedResult: string | null
    unexplainedDifference: string | null
    reconciliationStatus: ReconciliationStatus | null
  }
  /**
   * Ratio Modified Dietz del período seleccionado. No está anualizado
   * y no participa de la reconciliación.
   */
  periodReturn: {
    method: 'MODIFIED_DIETZ'
    status: 'CALCULATED' | 'INVALID_WEIGHTED_CAPITAL'
    decimal: string | null
  } | null
  historicalContributedCapital: null
  resultBreakdown: {
    positionValuation: string
    cashEconomicResult: string
    cash: {
      fxValuationChange: string
      dividends: string
      interest: string
      fees: string
      taxes: string
      otherCashResult: string
    } | null
  } | null
  allocation: AllocationItem[]
  /** Patrimonio informado menos la suma de tenencias y liquidez. No es una categoría. */
  allocationResidual: string
  evolution: PortfolioEvolutionPoint[]
  contributedCapitalStatus: 'unavailable'
  months: OverviewMonth[]
  importStatus: {
    documents: OverviewImportDocument[]
    reconciliationStatus: ReconciliationStatus | null
    unexplainedDifference: string | null
  }
  /** Reservado si el run quedó calculado con otro motor. La Home no lo muestra. */
  analysisNeedsRefresh: boolean
}

type SnapshotRepository = ReturnType<typeof createSnapshotRepository>
type ReconciliationRepository = ReturnType<typeof createReconciliationRepository>
type DocumentRepository = ReturnType<typeof createDocumentRepository>

export function periodLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? String(month)} ${year}`
}

/**
 * Totales de reconciliación: ReconciliationRun persistido.
 * Desglose de posiciones y caja: PerformanceAnalysisService, porque el run
 * no guarda esa apertura. Si el run no existe, los totales salen del mismo
 * análisis. Si el análisis falla y el run existe, el resumen muestra lo
 * guardado y el desglose queda en null.
 */
export async function loadPortfolioOverview(options: {
  db: DatabaseClient
  periodId?: string | null
}): Promise<PortfolioOverviewView | null> {
  const db = options.db
  const portfolios = createPortfolioRepository(db)
  const periods = createPeriodRepository(db)
  const snapshots = createSnapshotRepository(db)
  const documents = createDocumentRepository(db)
  const instruments = createInstrumentRepository(db)
  const reconciliations = createReconciliationRepository(db)
  const transactions = createTransactionRepository(db)
  const corporateActions = createCorporateActionRepository(db)
  const portfolio = (await portfolios.getAll())[0]
  if (!portfolio) return null

  const listed = await periods.getByPortfolio(portfolio.id)
  const selected = resolveOverviewPeriod(listed, options.periodId ?? null)
  if (!selected) return null

  const closing = await snapshots.getLatestByPeriod(selected.id)
  if (!closing) {
    throw new Error('El período completo no tiene snapshot de cierre.')
  }

  const run = await reconciliations.getLatestByPeriod(selected.id)
  const performance = createPerformanceAnalysisService({
    analysis: createPeriodAnalysisService({ periods, snapshots, transactions }),
    periods,
    snapshots,
    transactions,
    corporateActions,
  })

  let openingValue = run?.openingValue ?? null
  let contributions = run?.contributions ?? null
  let withdrawals = run?.withdrawals ?? null
  let investmentResult = run?.expectedResult ?? null
  let explainedResult = run?.explainedResult ?? null
  let unexplainedDifference = run?.difference ?? null
  let status = run?.status ?? null
  let resultBreakdown: PortfolioOverviewView['resultBreakdown'] = null
  let periodReturn: PortfolioOverviewView['periodReturn'] = null

  try {
    const analysis = await performance.analyzePeriod(selected.id)
    resultBreakdown = breakdownOf(analysis)
    periodReturn = {
      method: analysis.periodReturn.method,
      status: analysis.periodReturn.status,
      decimal: analysis.periodReturn.returnDecimal,
    }
    if (!run) {
      openingValue = analysis.base.openingValue
      contributions = analysis.base.contributions
      withdrawals = analysis.base.withdrawals
      investmentResult = analysis.base.investmentResult
      explainedResult = analysis.performance.explainedResult
      unexplainedDifference = analysis.performance.unexplainedDifference
      status = reconciliationStatus(analysis)
    }
  } catch (error) {
    console.error(error)
  }

  const netContributions =
    contributions !== null && withdrawals !== null
      ? calculateNetContributions(contributions, withdrawals)
      : null
  const portfolioValueChange =
    openingValue === null
      ? null
      : formatMonetary(parseDecimal(closing.totalValue).minus(parseDecimal(openingValue)))

  const aggregate = await snapshots.getAggregate(closing.id)
  const instrumentRows = await instruments.getAll()
  const categoryOf = new Map(instrumentRows.map((instrument) => [instrument.id, instrument.category]))
  const allocation = buildAllocation(
    aggregate?.positions ?? [],
    aggregate?.cashBalances ?? [],
    categoryOf,
    closing.totalValue,
    closing.currency,
  )

  const complete = listed
    .filter((period) => period.status === 'COMPLETE')
    .sort((left, right) => left.year - right.year || left.month - right.month)

  return {
    period: {
      id: selected.id,
      year: selected.year,
      month: selected.month,
      label: periodLabel(selected.year, selected.month),
      status: selected.status,
    },
    availablePeriods: complete.map((period) => ({
      id: period.id,
      year: period.year,
      month: period.month,
      label: periodLabel(period.year, period.month),
    })),
    metrics: {
      currentPortfolioValue: closing.totalValue,
      openingPortfolioValue: openingValue,
      portfolioValueChange,
      contributions,
      withdrawals,
      netContributions,
      investmentResult,
      explainedResult,
      unexplainedDifference,
      reconciliationStatus: status,
    },
    periodReturn,
    historicalContributedCapital: null,
    resultBreakdown,
    allocation: allocation.items,
    allocationResidual: allocation.residual,
    evolution: await evolutionPoints(listed, snapshots, closing.date),
    contributedCapitalStatus: 'unavailable',
    months: await monthRows(complete, snapshots, reconciliations),
    importStatus: {
      documents: await importDocumentsOf(selected, snapshots, documents),
      reconciliationStatus: status,
      unexplainedDifference,
    },
    analysisNeedsRefresh: run !== null && run.engineVersion !== ENGINE_VERSION,
  }
}

function breakdownOf(analysis: PeriodPerformanceAnalysis): PortfolioOverviewView['resultBreakdown'] {
  const cashEconomic = analysis.performance.breakdown.cashEconomicResult
  if (cashEconomic === null) return null
  const attribution = analysis.performance.cash.attribution
  return {
    positionValuation: analysis.performance.breakdown.valuationChange,
    cashEconomicResult: cashEconomic,
    cash: attribution
      ? {
          fxValuationChange: attribution.fxValuationChange,
          dividends: attribution.dividends,
          interest: attribution.interest,
          fees: attribution.fees,
          taxes: attribution.taxes,
          otherCashResult: attribution.otherCashResult,
        }
      : null,
  }
}

function buildAllocation(
  positions: readonly Position[],
  cashBalances: readonly CashBalance[],
  categoryOf: Map<string, InstrumentCategory>,
  totalValue: string,
  baseCurrency: string,
): { items: AllocationItem[]; residual: string } {
  const totals = new Map<InstrumentCategory | 'CASH', ReturnType<typeof parseDecimal>>()
  for (const position of positions) {
    const category = categoryOf.get(position.instrumentId) ?? 'OTHER'
    totals.set(category, (totals.get(category) ?? parseDecimal('0')).plus(position.marketValue))
  }

  let cash = parseDecimal('0')
  for (const balance of cashBalances) {
    if (balance.valueInBaseCurrency !== null) cash = cash.plus(balance.valueInBaseCurrency)
    else if (balance.currency === baseCurrency) cash = cash.plus(balance.amount)
  }
  if (!cash.isZero()) totals.set('CASH', cash)

  const total = parseDecimal(totalValue)
  const items = [...totals.entries()]
    .filter(([, value]) => !value.isZero())
    .sort((left, right) => right[1].cmp(left[1]))
    .map(([id, value]) => ({
      id,
      label: CATEGORY_LABEL[id],
      marketValue: formatExact(value),
      weight: total.isZero() ? '0.00' : value.div(total).toFixed(6),
    }))

  const allocated = items.reduce((sum, item) => sum.plus(item.marketValue), parseDecimal('0'))
  return { items, residual: formatExact(total.minus(allocated)) }
}

async function evolutionPoints(
  periods: readonly PortfolioPeriod[],
  snapshots: SnapshotRepository,
  closingDate: string,
): Promise<PortfolioEvolutionPoint[]> {
  const points: PortfolioEvolutionPoint[] = []
  for (const period of periods) {
    const rows = await snapshots.getByPeriod(period.id)
    for (const snapshot of rows) {
      if (snapshot.date > closingDate) continue
      points.push(pointOf(snapshot))
    }
  }
  return points.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
}

function pointOf(snapshot: PortfolioSnapshot): PortfolioEvolutionPoint {
  const month = Number(snapshot.date.slice(5, 7))
  return {
    id: snapshot.id,
    label: SHORT_MONTHS[month - 1] ?? snapshot.date,
    date: snapshot.date,
    portfolioValue: snapshot.totalValue,
  }
}

async function monthRows(
  complete: readonly PortfolioPeriod[],
  snapshots: SnapshotRepository,
  reconciliations: ReconciliationRepository,
): Promise<OverviewMonth[]> {
  const rows: OverviewMonth[] = []
  for (const period of [...complete].reverse()) {
    const snapshot = await snapshots.getLatestByPeriod(period.id)
    const run = await reconciliations.getLatestByPeriod(period.id)
    rows.push({
      periodId: period.id,
      label: periodLabel(period.year, period.month),
      closingValue: snapshot?.totalValue ?? null,
      netContributions: netOf(run),
      investmentResult: run?.expectedResult ?? null,
    })
  }
  return rows
}

function netOf(run: ReconciliationRun | null): string | null {
  if (!run) return null
  return calculateNetContributions(run.contributions, run.withdrawals)
}

async function importDocumentsOf(
  period: PortfolioPeriod,
  snapshots: SnapshotRepository,
  documents: DocumentRepository,
): Promise<OverviewImportDocument[]> {
  const closing = await snapshots.getLatestByPeriod(period.id)
  const opening = await snapshots.getLatestBefore(period.portfolioId, periodStartDate(period))
  const closingDocuments = await documents.getByPeriod(period.id)
  const openingDocument = opening?.sourceDocumentId
    ? await documents.getById(opening.sourceDocumentId)
    : null
  const openingDocuments = opening ? await documents.getByPeriod(opening.periodId) : []

  return [
    {
      id: 'opening_position',
      label: 'Posición apertura',
      present: isConsolidated(openingDocument) || openingDocuments.some(isConsolidated),
    },
    {
      id: 'closing_position',
      label: 'Posición cierre',
      present: closingDocuments.some(isConsolidated) || (await sourceIsConsolidated(closing?.sourceDocumentId ?? null, documents)),
    },
    {
      id: 'monthly_account',
      label: 'Resumen mensual',
      present: closingDocuments.some((document) => document.type === 'MONTHLY_ACCOUNT'),
    },
    {
      id: 'fund_statement',
      label: 'Resumen FCI',
      present: closingDocuments.some((document) => document.type === 'MONTHLY_FUND_STATEMENT'),
    },
  ]
}

function isConsolidated(document: PortfolioDocument | null | undefined): boolean {
  return document?.type === 'CONSOLIDATED_POSITION'
}

async function sourceIsConsolidated(
  documentId: EntityId | null,
  documents: DocumentRepository,
): Promise<boolean> {
  if (!documentId) return false
  return isConsolidated(await documents.getById(documentId))
}
