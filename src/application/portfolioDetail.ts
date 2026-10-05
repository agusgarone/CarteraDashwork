import type { DatabaseClient } from '../database/client'
import type { CorporateAction, CorporateActionType } from '../domain/corporateAction'
import type { CurrencyCode } from '../domain/currency'
import type { Instrument, InstrumentCategory } from '../domain/instrument'
import type { Position } from '../domain/snapshot'
import type { Transaction, TransactionType } from '../domain/transaction'
import {
  calculateTotalValuationChange,
  isIncludedInValuation,
} from '../engine/calculations/positionValuation'
import { formatExact, parseDecimal } from '../engine/money'
import type { PositionValuationResult, PositionValuationStatus } from '../engine/models/positionValuation'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createPeriodAnalysisService, periodStartDate } from '../engine/services/periodAnalysisService'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createPositionSourceRepository, type PositionFieldSource } from '../repositories/positionSourceRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { periodLabel } from './portfolioOverview'
import { resolveOverviewPeriod } from './overviewPeriod'

const CATEGORY_LABEL: Record<InstrumentCategory, string> = {
  STOCK: 'Acciones',
  CEDEAR: 'CEDEARs',
  CORPORATE_BOND: 'Obligaciones negociables',
  BOND: 'Bonos',
  FUND: 'Fondos',
  OTHER: 'Otros',
}

const STATUS_LABEL: Record<PositionValuationStatus, string> = {
  EXPLAINED: 'Explicado',
  CORPORATE_ACTION_EXPLAINED: 'Explicado · acción corporativa',
  HAS_PERIOD_TRANSACTION: 'Requiere cálculo de operaciones',
  QUANTITY_CHANGED: 'Cambio de cantidad sin explicar',
  CORPORATE_ACTION_MISMATCH: 'La acción corporativa no cierra la cantidad',
  HAS_CORPORATE_ACTION: 'Hay una acción corporativa sin cerrar',
  MISSING_OPENING_POSITION: 'Sin posición de apertura',
  MISSING_CLOSING_POSITION: 'Sin posición de cierre',
}

const TRANSACTION_LABEL: Record<TransactionType, string> = {
  CONTRIBUTION: 'Aporte',
  WITHDRAWAL: 'Retiro',
  BUY: 'Compra',
  SELL: 'Venta',
  DIVIDEND: 'Dividendo',
  INTEREST: 'Interés',
  FUND_SUBSCRIPTION: 'Suscripción',
  FUND_REDEMPTION: 'Rescate',
  FEE: 'Comisión',
  TAX: 'Impuesto',
  FX_CONVERSION: 'Conversión',
  OTHER: 'Otro',
}

const ACTION_LABEL: Record<CorporateActionType, string> = {
  STOCK_DIVIDEND: 'Dividendo en acciones',
  SPLIT: 'Split',
  REVERSE_SPLIT: 'Split inverso',
  RATIO_CHANGE: 'Cambio de ratio',
  OTHER: 'Acción corporativa',
}

export interface DetailMovement {
  id: string
  date: string
  type: TransactionType
  typeLabel: string
  quantity: string | null
  netAmount: string | null
  currency: CurrencyCode
}

export interface DetailCorporateAction {
  id: string
  date: string
  type: CorporateActionType
  typeLabel: string
  quantityBefore: string | null
  quantityChange: string | null
  quantityAfter: string | null
}

export interface InstrumentDetail {
  id: string
  ticker: string
  name: string | null
  categoryId: InstrumentCategory
  categoryLabel: string
  quantity: string | null
  openingQuantity: string | null
  openingQuantityDiffers: boolean
  currentValue: string | null
  openingValue: string | null
  valuationChange: string | null
  valuationStatus: PositionValuationStatus | null
  statusLabel: string | null
  movements: DetailMovement[]
  corporateActions: DetailCorporateAction[]
  provenance: string[]
}

export interface CategoryDetail {
  id: InstrumentCategory
  label: string
  closingValue: string
  openingValue: string | null
  valuationChange: string | null
  positionCount: number
}

export interface PortfolioDetailView {
  period: {
    id: string
    year: number
    month: number
    label: string
    status: string
  }
  categories: CategoryDetail[]
  instruments: InstrumentDetail[]
  totals: {
    investmentValue: string | null
    portfolioValue: string
    openingInvestmentValue: string | null
    valuationChange: string | null
  }
}

export type DetailSort = 'currentValue' | 'valuationChange'

export function visibleInstruments(
  instruments: readonly InstrumentDetail[],
  options: { categoryId: string; query: string; sort: DetailSort },
): InstrumentDetail[] {
  const query = options.query.trim().toLowerCase()
  return instruments
    .filter((instrument) => options.categoryId === 'ALL' || instrument.categoryId === options.categoryId)
    .filter((instrument) => {
      if (!query) return true
      return (
        instrument.ticker.toLowerCase().includes(query) ||
        (instrument.name?.toLowerCase().includes(query) ?? false)
      )
    })
    .sort((left, right) => compareMoney(valueOf(left, options.sort), valueOf(right, options.sort)))
}

function valueOf(instrument: InstrumentDetail, sort: DetailSort): string | null {
  return sort === 'valuationChange' ? instrument.valuationChange : instrument.currentValue
}

function compareMoney(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return parseDecimal(right).cmp(parseDecimal(left))
}

/**
 * La variación de una categoría suma solo lo que el motor marca como explicado.
 * No resta el total de cierre menos el de apertura.
 */
export async function loadPortfolioDetail(options: {
  db: DatabaseClient
  periodId?: string | null
}): Promise<PortfolioDetailView | null> {
  const db = options.db
  const portfolios = createPortfolioRepository(db)
  const periods = createPeriodRepository(db)
  const snapshots = createSnapshotRepository(db)
  const instruments = createInstrumentRepository(db)
  const transactions = createTransactionRepository(db)
  const corporateActions = createCorporateActionRepository(db)
  const sources = createPositionSourceRepository(db)
  const portfolio = (await portfolios.getAll())[0]
  if (!portfolio) return null

  const listed = await periods.getByPortfolio(portfolio.id)
  const selected = resolveOverviewPeriod(listed, options.periodId ?? null)
  if (!selected) return null

  const closing = await snapshots.getLatestByPeriod(selected.id)
  if (!closing) throw new Error('El período completo no tiene snapshot de cierre.')
  const closingAggregate = await snapshots.getAggregate(closing.id)
  const opening = await snapshots.getLatestBefore(portfolio.id, periodStartDate(selected))
  const openingAggregate = opening ? await snapshots.getAggregate(opening.id) : null

  const performance = createPerformanceAnalysisService({
    analysis: createPeriodAnalysisService({ periods, snapshots, transactions }),
    periods,
    snapshots,
    transactions,
    corporateActions,
  })

  let valuation: PositionValuationResult[] = []
  try {
    valuation = (await performance.analyzePeriod(selected.id)).performance.positionResults
  } catch (error) {
    console.error(error)
  }

  const instrumentRows = await instruments.getAll()
  const byId = new Map(instrumentRows.map((instrument) => [instrument.id, instrument]))
  const valuationById = new Map(valuation.map((result) => [result.instrumentId, result]))
  const openingById = new Map((openingAggregate?.positions ?? []).map((position) => [position.instrumentId, position]))
  const periodTransactions = await transactions.getByPeriod(selected.id)
  const periodActions = await corporateActions.getByPeriod(selected.id)
  const fieldSources = await sources.getBySnapshot(closing.id)

  const rows = (closingAggregate?.positions ?? []).map((position) =>
    instrumentOf(
      position,
      byId.get(position.instrumentId),
      valuationById.get(position.instrumentId) ?? null,
      openingById.get(position.instrumentId) ?? null,
      periodTransactions.filter((movement) => movement.instrumentId === position.instrumentId),
      periodActions.filter((action) => action.instrumentId === position.instrumentId),
      fieldSources.filter((source) => source.positionId === position.id),
    ),
  )

  const categories = categoriesOf(rows, valuationById, byId, openingAggregate?.positions ?? [])
  const explained = valuation.filter((result) => rows.some((row) => row.id === result.instrumentId))

  return {
    period: {
      id: selected.id,
      year: selected.year,
      month: selected.month,
      label: periodLabel(selected.year, selected.month),
      status: selected.status,
    },
    categories,
    instruments: visibleInstruments(rows, { categoryId: 'ALL', query: '', sort: 'currentValue' }),
    totals: {
      investmentValue: sumMoney(rows.map((row) => row.currentValue).filter((value): value is string => value !== null)),
      portfolioValue: closing.totalValue,
      openingInvestmentValue: sumMoney((openingAggregate?.positions ?? []).map((position) => position.marketValue)),
      valuationChange: explainedChange(explained),
    },
  }
}

function instrumentOf(
  position: Position,
  instrument: Instrument | undefined,
  valuation: PositionValuationResult | null,
  opening: Position | null,
  movements: Transaction[],
  actions: CorporateAction[],
  sources: PositionFieldSource[],
): InstrumentDetail {
  const categoryId = instrument?.category ?? 'OTHER'
  const change =
    valuation && isIncludedInValuation(valuation.status) ? valuation.valuationChange : null
  return {
    id: position.instrumentId,
    ticker: instrument?.ticker ?? position.instrumentId,
    name: instrument?.name ?? null,
    categoryId,
    categoryLabel: CATEGORY_LABEL[categoryId],
    quantity: position.quantity,
    openingQuantity: valuation?.openingQuantity ?? opening?.quantity ?? null,
    openingQuantityDiffers: quantitiesDiffer(
      valuation?.openingQuantity ?? opening?.quantity ?? null,
      position.quantity,
    ),
    currentValue: position.marketValue,
    openingValue: valuation?.openingValue ?? opening?.marketValue ?? null,
    valuationChange: change,
    valuationStatus: valuation?.status ?? null,
    statusLabel: valuation ? STATUS_LABEL[valuation.status] : null,
    movements: movements.map(movementOf),
    corporateActions: actions.map(actionOf),
    provenance: provenanceLines(sources),
  }
}

function movementOf(movement: Transaction): DetailMovement {
  return {
    id: movement.id,
    date: movement.date,
    type: movement.type,
    typeLabel: TRANSACTION_LABEL[movement.type],
    quantity: movement.quantity,
    netAmount: movement.netAmount,
    currency: movement.currency,
  }
}

function actionOf(action: CorporateAction): DetailCorporateAction {
  return {
    id: action.id,
    date: action.date,
    type: action.type,
    typeLabel: ACTION_LABEL[action.type],
    quantityBefore: action.quantityBefore,
    quantityChange: action.quantityChange,
    quantityAfter: action.quantityAfter,
  }
}

function provenanceLines(sources: readonly PositionFieldSource[]): string[] {
  const lines: string[] = []
  for (const source of sources) {
    if (source.documentType !== 'MONTHLY_FUND_STATEMENT') continue
    if (source.fieldName === 'market_value') lines.push('Valor proveniente de Resumen FCI')
    if (source.fieldName === 'quantity') lines.push('Cantidad proveniente de Resumen FCI')
    if (source.fieldName === 'unit_price') lines.push('Precio proveniente de Resumen FCI')
  }
  return [...new Set(lines)]
}

function categoriesOf(
  rows: readonly InstrumentDetail[],
  valuationById: Map<string, PositionValuationResult>,
  byId: Map<string, Instrument>,
  openingPositions: readonly Position[],
): CategoryDetail[] {
  const ids = [...new Set(rows.map((row) => row.categoryId))]
  return ids
    .map((id) => {
      const members = rows.filter((row) => row.categoryId === id)
      const memberIds = new Set(members.map((row) => row.id))
      const valuation = [...valuationById.values()].filter((result) => memberIds.has(result.instrumentId))
      const openingValues = openingPositions
        .filter((position) => (byId.get(position.instrumentId)?.category ?? 'OTHER') === id)
        .map((position) => position.marketValue)
      return {
        id,
        label: CATEGORY_LABEL[id],
        closingValue: sumMoney(members.map((row) => row.currentValue).filter((value): value is string => value !== null)) ?? '0.00',
        openingValue: sumMoney(openingValues),
        valuationChange: explainedChange(valuation),
        positionCount: members.length,
      }
    })
    .sort((left, right) => parseDecimal(right.closingValue).cmp(parseDecimal(left.closingValue)))
}

function explainedChange(results: readonly PositionValuationResult[]): string | null {
  const included = results.filter(
    (result) => isIncludedInValuation(result.status) && result.valuationChange !== null,
  )
  if (included.length === 0) return null
  return calculateTotalValuationChange(included)
}

function quantitiesDiffer(opening: string | null, closing: string | null): boolean {
  if (opening === null || closing === null) return false
  return !parseDecimal(opening).eq(closing)
}

function sumMoney(values: readonly string[]): string | null {
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum.plus(value), parseDecimal('0'))
  return formatExact(total)
}
