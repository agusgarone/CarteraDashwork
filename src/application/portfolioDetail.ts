import type { DatabaseClient } from '../database/client'
import type { CorporateAction, CorporateActionType } from '../domain/corporateAction'
import type { CurrencyCode } from '../domain/currency'
import type { Instrument, InstrumentCategory } from '../domain/instrument'
import type { Position } from '../domain/snapshot'
import type { Transaction, TransactionType } from '../domain/transaction'
import { isIncludedInValuation } from '../engine/calculations/positionValuation'
import type { PositionValueFlowAnalysis } from '../engine/calculations/positionValueFlow'
import { formatExact, parseDecimal } from '../engine/money'
import type { PositionValuationResult, PositionValuationStatus } from '../engine/models/positionValuation'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createPeriodAnalysisService, periodStartDate } from '../engine/services/periodAnalysisService'
import { createCashMovementLegRepository } from '../repositories/cashMovementLegRepository'
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
  boughtQuantity: string | null
  soldQuantity: string | null
  subscribedQuantity: string | null
  quantityStatusLabel: string | null
  acquisitionFlows: string | null
  disposalFlows: string | null
  flowNote: string | null
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
  const cashLegs = createCashMovementLegRepository(db)
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
    cashLegs,
  })

  let valuation: PositionValuationResult[] = []
  let flows: PositionValueFlowAnalysis[] = []
  try {
    const analysis = await performance.analyzePeriod(selected.id)
    valuation = analysis.performance.positionResults
    flows = analysis.performance.positionFlows
  } catch (error) {
    console.error(error)
  }

  const instrumentRows = await instruments.getAll()
  const byId = new Map(instrumentRows.map((instrument) => [instrument.id, instrument]))
  const valuationById = new Map(valuation.map((result) => [result.instrumentId, result]))
  const flowById = new Map(flows.map((flow) => [flow.instrumentId, flow]))
  const openingById = new Map((openingAggregate?.positions ?? []).map((position) => [position.instrumentId, position]))
  const periodTransactions = await transactions.getByPeriod(selected.id)
  const periodActions = await corporateActions.getByPeriod(selected.id)
  const fieldSources = await sources.getBySnapshot(closing.id)

  const rows = (closingAggregate?.positions ?? []).map((position) =>
    instrumentOf(
      position,
      byId.get(position.instrumentId),
      valuationById.get(position.instrumentId) ?? null,
      flowById.get(position.instrumentId) ?? null,
      openingById.get(position.instrumentId) ?? null,
      periodTransactions.filter((movement) => movement.instrumentId === position.instrumentId),
      periodActions.filter((action) => action.instrumentId === position.instrumentId),
      fieldSources.filter((source) => source.positionId === position.id),
    ),
  )
  for (const flow of flows) {
    if (rows.some((row) => row.id === flow.instrumentId)) continue
    if (flow.quantity.actualClosingQuantity !== '0') continue
    rows.push(
      closedInstrument(
        flow,
        byId.get(flow.instrumentId),
        periodTransactions.filter((movement) => movement.instrumentId === flow.instrumentId),
        periodActions.filter((action) => action.instrumentId === flow.instrumentId),
      ),
    )
  }

  const categories = categoriesOf(rows, byId, openingAggregate?.positions ?? [])
  const explainedChanges = rows.map((row) => row.valuationChange).filter((value): value is string => value !== null)

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
      valuationChange: sumMoney(explainedChanges),
    },
  }
}

function instrumentOf(
  position: Position,
  instrument: Instrument | undefined,
  valuation: PositionValuationResult | null,
  flow: PositionValueFlowAnalysis | null,
  opening: Position | null,
  movements: Transaction[],
  actions: CorporateAction[],
  sources: PositionFieldSource[],
): InstrumentDetail {
  const categoryId = instrument?.category ?? 'OTHER'
  const legacyChange = valuation && isIncludedInValuation(valuation.status) ? valuation.valuationChange : null
  const flowApplies =
    flow?.periodPositionResult != null &&
    (valuation == null ||
      valuation.status === 'HAS_PERIOD_TRANSACTION' ||
      valuation.status === 'MISSING_OPENING_POSITION' ||
      valuation.status === 'MISSING_CLOSING_POSITION')
  const change = legacyChange ?? (flowApplies ? flow.periodPositionResult : null)
  const openingQuantity = flow?.quantity.openingQuantity ?? valuation?.openingQuantity ?? opening?.quantity ?? null
  return {
    id: position.instrumentId,
    ticker: instrument?.ticker ?? position.instrumentId,
    name: instrument?.name ?? null,
    categoryId,
    categoryLabel: CATEGORY_LABEL[categoryId],
    quantity: position.quantity,
    openingQuantity,
    openingQuantityDiffers: quantitiesDiffer(openingQuantity, position.quantity),
    currentValue: position.marketValue,
    openingValue: flow?.openingValue ?? valuation?.openingValue ?? opening?.marketValue ?? null,
    valuationChange: change,
    valuationStatus: valuation?.status ?? null,
    statusLabel: flowLabel(flow, valuation, flowApplies),
    boughtQuantity: flow?.quantity.boughtQuantity ?? null,
    soldQuantity: flow?.quantity.soldQuantity ?? null,
    subscribedQuantity: flow?.quantity.subscribedQuantity ?? null,
    quantityStatusLabel: flow ? (flow.quantity.status === 'RECONCILED' ? 'Cantidad reconciliada' : 'La cantidad no cierra') : null,
    acquisitionFlows: flow?.acquisitionFlows ?? null,
    disposalFlows: flow?.disposalFlows ?? null,
    flowNote: flow?.valueStatus === 'MISSING_TRANSACTION_FX' ? flow.reason : null,
    movements: movements.map(movementOf),
    corporateActions: actions.map(actionOf),
    provenance: provenanceLines(sources),
  }
}

function closedInstrument(
  flow: PositionValueFlowAnalysis,
  instrument: Instrument | undefined,
  movements: Transaction[],
  actions: CorporateAction[],
): InstrumentDetail {
  const categoryId = instrument?.category ?? 'OTHER'
  return {
    id: flow.instrumentId,
    ticker: instrument?.ticker ?? flow.instrumentId,
    name: instrument?.name ?? null,
    categoryId,
    categoryLabel: CATEGORY_LABEL[categoryId],
    quantity: '0',
    openingQuantity: flow.quantity.openingQuantity,
    openingQuantityDiffers: true,
    currentValue: '0.00',
    openingValue: flow.openingValue,
    valuationChange: flow.periodPositionResult,
    valuationStatus: null,
    statusLabel: flowLabel(flow, null, flow.periodPositionResult != null),
    boughtQuantity: flow.quantity.boughtQuantity,
    soldQuantity: flow.quantity.soldQuantity,
    subscribedQuantity: flow.quantity.subscribedQuantity,
    quantityStatusLabel: flow.quantity.status === 'RECONCILED' ? 'Cantidad reconciliada' : 'La cantidad no cierra',
    acquisitionFlows: flow.acquisitionFlows,
    disposalFlows: flow.disposalFlows,
    flowNote: flow.valueStatus === 'MISSING_TRANSACTION_FX' ? flow.reason : null,
    movements: movements.map(movementOf),
    corporateActions: actions.map(actionOf),
    provenance: [],
  }
}

function flowLabel(
  flow: PositionValueFlowAnalysis | null,
  valuation: PositionValuationResult | null,
  usingFlowResult: boolean,
): string | null {
  if (flow?.valueStatus === 'MISSING_TRANSACTION_FX') return 'Pendiente: falta tipo de cambio de la operación.'
  if (flow?.valueStatus === 'QUANTITY_MISMATCH') return 'La cantidad no cierra'
  if (flow?.valueStatus === 'QUANTITY_RECONCILED_VALUE_PENDING') return 'Cantidad reconciliada. Valor pendiente.'
  if (valuation && isIncludedInValuation(valuation.status)) return STATUS_LABEL[valuation.status]
  if (usingFlowResult && flow?.valueStatus === 'CLOSED_DURING_PERIOD') return 'Cerrada en el período'
  if (usingFlowResult && flow?.valueStatus === 'OPENED_DURING_PERIOD') return 'Abierta en el período'
  if (usingFlowResult && flow?.valueStatus === 'CORPORATE_ACTION_EXPLAINED') return 'Explicado · acción corporativa'
  if (usingFlowResult) return 'Explicado'
  return valuation ? STATUS_LABEL[valuation.status] : null
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
  byId: Map<string, Instrument>,
  openingPositions: readonly Position[],
): CategoryDetail[] {
  const ids = [...new Set(rows.map((row) => row.categoryId))]
  return ids
    .map((id) => {
      const members = rows.filter((row) => row.categoryId === id)
      const openingValues = openingPositions
        .filter((position) => (byId.get(position.instrumentId)?.category ?? 'OTHER') === id)
        .map((position) => position.marketValue)
      const changes = members.map((row) => row.valuationChange).filter((value): value is string => value !== null)
      return {
        id,
        label: CATEGORY_LABEL[id],
        closingValue: sumMoney(members.map((row) => row.currentValue).filter((value): value is string => value !== null)) ?? '0.00',
        openingValue: sumMoney(openingValues),
        valuationChange: changes.length === 0 ? null : sumMoney(changes),
        positionCount: members.length,
      }
    })
    .sort((left, right) => parseDecimal(right.closingValue).cmp(parseDecimal(left.closingValue)))
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
