import { resolveOperationTicker } from '../parsers/balanz/operationTicker'
import type { DatabaseClient } from '../database/client'
import type { EntityId } from '../domain/common'
import type { InstrumentCategory } from '../domain/instrument'
import type { CashBalance, PortfolioSnapshotAggregate } from '../domain/snapshot'
import { parseDecimal } from '../engine/money'
import { ENGINE_VERSION } from '../engine/version'
import type { PeriodPerformanceAnalysis } from '../engine/models/periodPerformance'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createPeriodAnalysisService } from '../engine/services/periodAnalysisService'
import type { ParsedConsolidatedPosition } from '../parsers/models/parsedConsolidatedPosition'
import { createCashMovementLegRepository } from '../repositories/cashMovementLegRepository'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createDocumentRepository } from '../repositories/documentRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createReconciliationRepository } from '../repositories/reconciliationRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { createTransactionFxRepository } from '../repositories/transactionFxRepository'
import { adaptConsolidatedPosition } from './adapters/consolidatedPositionAdapter'
import { adaptMonthlyAccount } from './adapters/monthlyAccountAdapter'
import { cashMovementLegsFromAccount } from './cashMovementLegs'
import { assertPeriodResultsMatch, planTransactionFxEnrichments } from './enrichment/periodResultsEnrichment'
import type { ImportFileSystem } from './documentStore'
import { fundMatchKeyFromConsolidatedName } from './fundIdentity'
import { ImportConflictError, ImportPeriodValidationError } from './importPeriodErrors'
import { PARSER_VERSION } from './parserVersion'
import {
  persistImportPlan,
  type ImportCorporateActionRow,
  type ImportInstrumentRow,
  type ImportPersistencePlan,
  type ImportPositionRow,
  type ImportTransactionRow,
} from './persistence/importPersistenceRepository'
import {
  prepareImportPeriod,
  type ClassifiedPosition,
  type ImportFile,
  type PreparedImport,
} from './prepareImportPeriod'
import { reconciliationStatus } from './reconciliationPolicy'

export type { ImportFile } from './prepareImportPeriod'

export interface ImportPeriodInput {
  portfolioId: EntityId
  files: ImportFile[]
}

export interface ImportPeriodResult {
  outcome: 'imported' | 'existing'
  periodId: EntityId
  openingSnapshotId: EntityId
  closingSnapshotId: EntityId
  analysis: PeriodPerformanceAnalysis | null
}

export interface ImportPeriodService {
  importPeriod(input: ImportPeriodInput): Promise<ImportPeriodResult>
}

export interface ImportPeriodServiceOptions {
  db: DatabaseClient
  appDataDir: string
  files: ImportFileSystem
  now?: () => string
  /** Se ejecuta después de copiar los archivos y antes de la transacción. Los tests lo usan para forzar un fallo. */
  beforePersist?: () => Promise<void> | void
}

/**
 * Documentos ya elegidos → parseo → validación → una transacción → motor leyendo SQLite.
 *
 * La base y el disco no comparten una transacción. Si el insert falla, se borran solo
 * los archivos que este intento creó. El original del usuario no se mueve.
 * La corrida de reconciliación se escribe después del COMMIT. Si ese segundo paso
 * falla, el período queda importado y el resultado vuelve con analysis en null.
 * Un reintento del mismo set completa el análisis sin duplicar documentos.
 *
 * Volver a importar los mismos archivos devuelve el período existente.
 * Otro hash para la misma fecha de snapshot es un conflicto y no pisa nada.
 * Un reproceso explícito queda para más adelante: esta deduplicación no lo impide,
 * porque identifica el archivo y no la operación.
 */
export function createImportPeriodService(options: ImportPeriodServiceOptions): ImportPeriodService {
  const db = options.db
  const portfolios = createPortfolioRepository(db)
  const periods = createPeriodRepository(db)
  const documents = createDocumentRepository(db)
  const instruments = createInstrumentRepository(db)
  const snapshots = createSnapshotRepository(db)
  const reconciliations = createReconciliationRepository(db)

  return {
    async importPeriod(input) {
      const portfolio = await portfolios.getById(input.portfolioId)
      if (!portfolio) {
        throw new ImportPeriodValidationError('La cartera no existe.')
      }

      const fileSystem = options.files
      const stagingDir = fileSystem.join(options.appDataDir, 'staging')
      const createdFiles: string[] = []
      let persisted = false
      try {
        const prepared = await prepareImportPeriod(input.files, stagingDir, fileSystem)
        await rememberExistingDocuments(prepared, input.portfolioId)
        const reusedOpeningId = await resolveOpening(prepared, input.portfolioId)
        const reusedClosingId = await reusableSnapshotId(input.portfolioId, prepared.closing)
        await assertResultsBelongToPeriod(prepared, reusedOpeningId)
        await assertPeriodIsNewOrSameFiles(prepared, input.portfolioId)

        const alreadyImported = await existingImport(prepared, input.portfolioId, reusedOpeningId)
        if (alreadyImported) {
          await createCashMovementLegRepository(db).saveIfMissing(
            alreadyImported.periodId,
            cashMovementLegsFromAccount(prepared.account.parsed),
          )
          await writeResultsEnrichment(prepared, alreadyImported.periodId)
          const analysis = await readAnalysis(alreadyImported.periodId)
          return { outcome: 'existing', ...alreadyImported, analysis }
        }

        const resultsOnly = await resultsOnlyImport(prepared, input.portfolioId, reusedOpeningId)
        if (resultsOnly && prepared.results) {
          const file = prepared.results.file
          const published = await fileSystem.publish(options.appDataDir, file.relativePath, file.stagedPath)
          if (published.created) createdFiles.push(file.relativePath)
          await options.beforePersist?.()
          await documents.create({
            periodId: resultsOnly.periodId,
            type: 'PERIOD_RESULTS',
            originalFilename: file.originalFileName,
            localPath: file.relativePath,
            sha256: file.sha256,
            processingStatus: 'PROCESSED',
            parserVersion: PARSER_VERSION,
          })
          persisted = true
          await writeResultsEnrichment(prepared, resultsOnly.periodId)
          const analysis = await readAnalysis(resultsOnly.periodId)
          return { outcome: 'imported', ...resultsOnly, analysis }
        }

        for (const file of prepared.files) {
          if (file.existingDocumentId) continue
          const published = await fileSystem.publish(options.appDataDir, file.relativePath, file.stagedPath)
          if (published.created) createdFiles.push(file.relativePath)
        }

        await options.beforePersist?.()
        const plan = await buildPlan(
          prepared,
          input.portfolioId,
          reusedOpeningId,
          reusedClosingId,
          options.now?.() ?? new Date().toISOString(),
        )
        const saved = await persistImportPlan(db, plan)
        persisted = true
        await writeResultsEnrichment(prepared, saved.closingPeriodId)
        const analysis = await readAnalysis(saved.closingPeriodId)
        return {
          outcome: 'imported',
          periodId: saved.closingPeriodId,
          openingSnapshotId: saved.openingSnapshotId,
          closingSnapshotId: saved.closingSnapshotId,
          analysis,
        }
      } catch (error) {
        if (!persisted) {
          await Promise.all(createdFiles.map((relativePath) => fileSystem.removePublished(options.appDataDir, relativePath)))
        }
        throw error
      } finally {
        await fileSystem.removeDir(stagingDir)
      }
    },
  }

  async function readAnalysis(periodId: EntityId): Promise<PeriodPerformanceAnalysis | null> {
    try {
      const analysis = await analyzeFromDatabase(db, periodId)
      await ensureReconciliation(periodId, analysis)
      return analysis
    } catch (error) {
      console.error('El período quedó importado y el análisis no se guardó.', error)
      return null
    }
  }

  async function rememberExistingDocuments(prepared: PreparedImport, portfolioId: EntityId): Promise<void> {
    for (const file of prepared.files) {
      const existing = await documents.getByHash(file.sha256)
      if (!existing) continue
      const period = await periods.getById(existing.periodId)
      if (period && period.portfolioId !== portfolioId) {
        throw new ImportConflictError('El documento ya está importado en otra cartera.')
      }
      file.existingDocumentId = existing.id
      file.relativePath = existing.localPath
    }
  }

  async function resolveOpening(prepared: PreparedImport, portfolioId: EntityId): Promise<EntityId | null> {
    if (prepared.opening) return reusableSnapshotId(portfolioId, prepared.opening)
    const existing = await snapshots.getLatestBefore(portfolioId, prepared.account.parsed.period.startDate)
    if (!existing) {
      throw new ImportPeriodValidationError('Falta la posición de apertura y no hay un snapshot anterior.')
    }
    return existing.id
  }

  /**
   * Un snapshot es el estado de la cartera en una fecha.
   * El mismo archivo puede ser el cierre de un mes y la apertura del siguiente.
   * Si la fecha ya existe con otro documento o con otros valores, no se pisa.
   */
  async function reusableSnapshotId(portfolioId: EntityId, classified: ClassifiedPosition): Promise<EntityId | null> {
    const date = classified.position.snapshotDate
    const snapshot = await snapshots.getByDate(portfolioId, date)
    if (!snapshot) return null
    if (!snapshot.sourceDocumentId) {
      throw new ImportConflictError(`Ya hay un snapshot el ${date} sin documento de origen.`)
    }
    const source = await documents.getById(snapshot.sourceDocumentId)
    if (!source || source.sha256 !== classified.file.sha256) {
      throw new ImportConflictError(`Ya hay otro documento para el snapshot ${date}.`)
    }
    const aggregate = await snapshots.getAggregate(snapshot.id)
    const incomingCash = adaptConsolidatedPosition(classified.enriched.position, {
      portfolioId,
      periodId: snapshot.periodId,
      createdAt: snapshot.createdAt,
    }).cashBalances
    if (!aggregate || !(await sameSnapshotContent(aggregate, classified, incomingCash))) {
      throw new ImportConflictError(`Ya hay otro documento para el snapshot ${date}.`)
    }
    return snapshot.id
  }

  async function sameSnapshotContent(
    stored: PortfolioSnapshotAggregate,
    classified: ClassifiedPosition,
    incomingCash: readonly CashBalance[],
  ): Promise<boolean> {
    if (!sameMoney(stored.snapshot.totalValue, classified.position.reportedTotal)) return false
    if (!sameCash(stored.cashBalances, incomingCash)) return false
    const known = new Map((await instruments.getAll()).map((instrument) => [instrument.id, instrument]))
    const storedHoldings = stored.positions.map((position) => {
      const instrument = known.get(position.instrumentId)
      return {
        key: instrument ? `${instrument.ticker}|${instrument.category}` : position.instrumentId,
        quantity: position.quantity,
        unitPrice: position.unitPrice,
        marketValue: position.marketValue,
      }
    })
    const incomingHoldings = classified.enriched.position.positions.map((position) => ({
      key: `${position.ticker}|${position.normalizedCategory}`,
      quantity: position.quantity,
      unitPrice: position.unitPrice ?? '',
      marketValue: position.marketValue,
    }))
    if (storedHoldings.length !== incomingHoldings.length) return false
    const incomingByKey = new Map(incomingHoldings.map((holding) => [holding.key, holding]))
    if (incomingByKey.size !== incomingHoldings.length) return false
    return storedHoldings.every((holding) => {
      const incoming = incomingByKey.get(holding.key)
      return (
        incoming !== undefined &&
        sameMoney(holding.quantity, incoming.quantity) &&
        sameMoney(holding.unitPrice, incoming.unitPrice) &&
        sameMoney(holding.marketValue, incoming.marketValue)
      )
    })
  }

  async function assertPeriodIsNewOrSameFiles(prepared: PreparedImport, portfolioId: EntityId): Promise<void> {
    const period = await periods.getByYearMonth(portfolioId, prepared.closingPeriod.year, prepared.closingPeriod.month)
    if (period?.status !== 'COMPLETE') return
    const requiredKnown = prepared.files
      .filter((file) => file.kind !== 'PERIOD_RESULTS')
      .every((file) => file.existingDocumentId)
    const addingResults = prepared.results !== null && prepared.results.file.existingDocumentId === null && requiredKnown
    const sameFiles = prepared.files.every((file) => file.existingDocumentId)
    if (sameFiles || addingResults) return
    throw new ImportConflictError('El período ya fue importado con otros documentos.')
  }

  async function assertResultsBelongToPeriod(prepared: PreparedImport, reusedOpeningId: EntityId | null): Promise<void> {
    if (!prepared.results) return
    const reusedOpening = reusedOpeningId ? await snapshots.getAggregate(reusedOpeningId) : null
    assertPeriodResultsMatch(prepared.results.parsed, {
      openingDate: prepared.opening?.position.snapshotDate ?? reusedOpening?.snapshot.date ?? null,
      closingDate: prepared.closing.position.snapshotDate,
      calendarPeriod: prepared.account.parsed.period,
    })
  }

  async function writeResultsEnrichment(prepared: PreparedImport, periodId: EntityId): Promise<void> {
    if (!prepared.results) return
    const stored = await documents.getByHash(prepared.results.file.sha256)
    if (!stored) return
    const fx = createTransactionFxRepository(db)
    const targets = await fx.targetsByPeriod(periodId)
    const planned = planTransactionFxEnrichments(prepared.results.parsed, targets)
    await fx.saveIfMissing(stored.id, planned)
  }

  async function existingImport(
    prepared: PreparedImport,
    portfolioId: EntityId,
    reusedOpeningId: EntityId | null,
  ): Promise<{ periodId: EntityId; openingSnapshotId: EntityId; closingSnapshotId: EntityId } | null> {
    if (prepared.files.some((file) => !file.existingDocumentId)) return null
    const period = await periods.getByYearMonth(portfolioId, prepared.closingPeriod.year, prepared.closingPeriod.month)
    const closing = await snapshots.getByDate(portfolioId, prepared.closing.position.snapshotDate)
    const openingSnapshot = prepared.opening
      ? await snapshots.getByDate(portfolioId, prepared.opening.position.snapshotDate)
      : reusedOpeningId
        ? (await snapshots.getAggregate(reusedOpeningId))?.snapshot ?? null
        : null
    if (!period || period.status !== 'COMPLETE' || !openingSnapshot || !closing) return null
    return { periodId: period.id, openingSnapshotId: openingSnapshot.id, closingSnapshotId: closing.id }
  }

  async function resultsOnlyImport(
    prepared: PreparedImport,
    portfolioId: EntityId,
    reusedOpeningId: EntityId | null,
  ): Promise<{ periodId: EntityId; openingSnapshotId: EntityId; closingSnapshotId: EntityId } | null> {
    if (!prepared.results || prepared.results.file.existingDocumentId) return null
    const requiredKnown = prepared.files
      .filter((file) => file.kind !== 'PERIOD_RESULTS')
      .every((file) => file.existingDocumentId)
    if (!requiredKnown) return null
    const period = await periods.getByYearMonth(portfolioId, prepared.closingPeriod.year, prepared.closingPeriod.month)
    const closing = await snapshots.getByDate(portfolioId, prepared.closing.position.snapshotDate)
    const openingSnapshot = prepared.opening
      ? await snapshots.getByDate(portfolioId, prepared.opening.position.snapshotDate)
      : reusedOpeningId
        ? (await snapshots.getAggregate(reusedOpeningId))?.snapshot ?? null
        : null
    if (!period || period.status !== 'COMPLETE' || !openingSnapshot || !closing) return null
    return { periodId: period.id, openingSnapshotId: openingSnapshot.id, closingSnapshotId: closing.id }
  }

  async function ensureReconciliation(periodId: EntityId, analysis: PeriodPerformanceAnalysis): Promise<void> {
    if (analysis.performance.attributionStatus === 'PENDING') return
    const explainedResult = analysis.performance.explainedResult
    const difference = analysis.performance.unexplainedDifference
    if (explainedResult === null || difference === null) return
    const latest = await reconciliations.getLatestByPeriod(periodId)
    if (latest) return
    await reconciliations.create({
      periodId,
      openingValue: analysis.base.openingValue,
      closingValue: analysis.base.closingValue,
      contributions: analysis.base.contributions,
      withdrawals: analysis.base.withdrawals,
      expectedResult: analysis.performance.expectedResult,
      explainedResult,
      difference,
      status: reconciliationStatus(analysis),
      engineVersion: ENGINE_VERSION,
    })
  }

  async function buildPlan(
    prepared: PreparedImport,
    portfolioId: EntityId,
    reusedOpeningId: EntityId | null,
    reusedClosingId: EntityId | null,
    completedAt: string,
  ): Promise<ImportPersistencePlan> {
    const openingPeriod = prepared.openingPeriod
      ? await periods.getByYearMonth(portfolioId, prepared.openingPeriod.year, prepared.openingPeriod.month)
      : null
    const closingPeriod = await periods.getByYearMonth(
      portfolioId,
      prepared.closingPeriod.year,
      prepared.closingPeriod.month,
    )
    const positions = [
      ...(prepared.opening?.enriched.position.positions ?? []),
      ...prepared.closing.enriched.position.positions,
    ]
    const instrumentRows: ImportInstrumentRow[] = []
    for (const position of positions) {
      const key = instrumentKey(position.ticker, position.normalizedCategory)
      if (instrumentRows.some((row) => row.key === key)) continue
      const found = await instruments.findByTickerAndCategory(position.ticker, position.normalizedCategory)
      instrumentRows.push({
        key,
        existingId: found?.id ?? null,
        ticker: position.ticker,
        name: position.name,
        category: position.normalizedCategory,
        currency: 'ARS',
      })
    }

    // An instrument bought and fully sold within the month has no boundary position.
    // Keep its trades even when the documents do not provide a normalized category.
    const knownInstruments = await instruments.getAll()
    const movementTickers = new Set([
      ...prepared.account.parsed.transactions.map(row => row.ticker),
      ...prepared.account.parsed.corporateActions.map(row => row.ticker),
    ])
    for (const ticker of movementTickers) {
      if (!ticker || instrumentRows.some(row => row.ticker === ticker)) continue
      const known = knownInstruments.filter(row => row.ticker === ticker)
      if (known.length > 1) throw new ImportPeriodValidationError(`No hay un instrumento único para ${ticker}.`)
      const found = known[0]
      const category = found?.category ?? 'OTHER'
      instrumentRows.push({
        key: instrumentKey(ticker, category), existingId: found?.id ?? null,
        ticker, name: found?.name ?? ticker, category, currency: found?.currency ?? 'ARS',
      })
    }
    const openingAdapted = prepared.opening
      ? adaptConsolidatedPosition(prepared.opening.enriched.position, {
          portfolioId,
          periodId: openingPeriod?.id ?? 'pending-opening',
          createdAt: completedAt,
        })
      : null
    const closingAdapted = adaptConsolidatedPosition(prepared.closing.enriched.position, {
      portfolioId,
      periodId: closingPeriod?.id ?? 'pending-closing',
      createdAt: completedAt,
    })
    const movements = adaptMonthlyAccount(prepared.account.parsed, {
      portfolioId,
      periodId: closingPeriod?.id ?? 'pending-closing',
      createdAt: completedAt,
    })

    const openingSnapshotId = prepared.opening
      ? (await snapshots.getByDate(portfolioId, prepared.opening.position.snapshotDate))?.id ?? null
      : reusedOpeningId

    return {
      portfolioId,
      completedAt,
      periods: [
        ...(prepared.openingPeriod
          ? [
              {
                key: 'opening',
                existingId: openingPeriod?.id ?? null,
                year: prepared.openingPeriod.year,
                month: prepared.openingPeriod.month,
                completes: false,
              },
            ]
          : []),
        {
          key: 'closing',
          existingId: closingPeriod?.id ?? null,
          year: prepared.closingPeriod.year,
          month: prepared.closingPeriod.month,
          completes: true,
        },
      ],
      documents: prepared.files.map((file) => ({
        key: file.key,
        existingId: file.existingDocumentId,
        periodKey: file.periodKey,
        type: file.kind,
        originalFilename: file.originalFileName,
        localPath: file.relativePath,
        sha256: file.sha256,
        parserVersion: PARSER_VERSION,
      })),
      instruments: instrumentRows,
      snapshots: [
        ...(prepared.opening
          ? [
              snapshotRow(
                'opening',
                'opening',
                prepared.opening,
                openingAdapted?.cashBalances ?? [],
                openingSnapshotId,
              ),
            ]
          : [
              {
                key: 'opening',
                periodKey: 'opening',
                documentKey: 'closing-position',
                date: '',
                totalValue: '0',
                currency: 'ARS' as const,
                existingId: openingSnapshotId,
                positions: [],
                cash: [],
                rawDifference: '0',
                enrichedDifference: '0',
              },
            ]),
        snapshotRow('closing', 'closing', prepared.closing, closingAdapted.cashBalances, reusedClosingId),
      ],
      transactions: movements.transactions.map((movement, index) =>
        transactionRow(movement, prepared.account.parsed.transactions[index]?.ticker ?? null, instrumentRows),
      ),
      corporateActions: movements.corporateActions.map((action, index) =>
        actionRow(action, prepared.account.parsed.corporateActions[index]?.ticker ?? '', instrumentRows),
      ),
      cashLegs: cashMovementLegsFromAccount(prepared.account.parsed).map((leg) => ({
        operationReference: leg.operationId,
        operationType: leg.operationType,
        currency: leg.currency,
        amount: leg.amount,
        date: leg.date,
        role: leg.role,
        commission: leg.commission ?? null,
        vat: leg.vat ?? null,
        marketFees: leg.marketFees ?? null,
        taxComponent: leg.taxComponent ?? null,
      })),
    }
  }
}

async function analyzeFromDatabase(db: DatabaseClient, periodId: EntityId): Promise<PeriodPerformanceAnalysis> {
  const periods = createPeriodRepository(db)
  const snapshots = createSnapshotRepository(db)
  const transactions = createTransactionRepository(db)
  const corporateActions = createCorporateActionRepository(db)
  const cashLegs = createCashMovementLegRepository(db)
  const fxEnrichments = createTransactionFxRepository(db)
  const service = createPerformanceAnalysisService({
    instruments: createInstrumentRepository(db),
    analysis: createPeriodAnalysisService({ periods, snapshots, transactions }),
    periods,
    snapshots,
    transactions,
    corporateActions,
    cashLegs,
    fxEnrichments,
  })
  return service.analyzePeriod(periodId)
}

function snapshotRow(
  key: string,
  periodKey: string,
  classified: ClassifiedPosition,
  cash: ReturnType<typeof adaptConsolidatedPosition>['cashBalances'],
  existingId: string | null,
): ImportPersistencePlan['snapshots'][number] {
  return {
    key,
    periodKey,
    documentKey: classified.file.key,
    date: classified.position.snapshotDate,
    totalValue: classified.position.reportedTotal,
    currency: 'ARS',
    existingId,
    positions: existingId ? [] : classified.enriched.position.positions.map((position) => positionRow(position, classified)),
    cash: existingId
      ? []
      : cash.map((balance) => ({
          currency: balance.currency,
          amount: balance.amount,
          fxRate: balance.fxRate,
          valueInBaseCurrency: balance.valueInBaseCurrency,
        })),
    rawDifference: classified.position.reconciliation.difference,
    enrichedDifference: classified.enriched.enrichedDetail.difference,
  }
}

function positionRow(
  position: ParsedConsolidatedPosition['positions'][number],
  classified: ClassifiedPosition,
): ImportPositionRow {
  if (position.unitPrice === null) {
    throw new ImportPeriodValidationError(`La tenencia ${position.ticker} no tiene precio impreso.`)
  }
  const fundIdentity =
    position.normalizedCategory === 'FUND' ? fundMatchKeyFromConsolidatedName(position.name, 'ARS') : null
  const identity = fundIdentity ?? position.ticker
  const audit = classified.enriched.audits.find((item) => item.positionIdentity === identity)
  if (!audit) {
    throw new ImportPeriodValidationError(`No hay procedencia para ${position.ticker}.`)
  }
  const documentKey =
    audit.marketValueSource.documentType === 'MONTHLY_FUND_STATEMENT' ? 'fund-statement' : classified.file.key
  const source = audit.marketValueSource
  return {
    instrumentKey: instrumentKey(position.ticker, position.normalizedCategory),
    quantity: position.quantity,
    unitPrice: position.unitPrice,
    marketValue: position.marketValue,
    currency: 'ARS',
    sources: (['quantity', 'unit_price', 'market_value'] as const).map((field) => ({
      field,
      documentKey,
      sourceReference: source.sourceReference,
      asOfDate: source.asOfDate,
    })),
  }
}

function transactionRow(
  movement: ReturnType<typeof adaptMonthlyAccount>['transactions'][number],
  ticker: string | null,
  instrumentRows: readonly ImportInstrumentRow[],
): ImportTransactionRow {
  const explicitTicker = resolveOperationTicker({ description: movement.sourceReference ?? '' })
  if (explicitTicker && ticker !== explicitTicker) {
    throw new ImportPeriodValidationError(`El instrumento de la operación ${movement.sourceReference} no coincide con ${ticker ?? 'ninguno'}.`)
  }
  return {
    instrumentKey: ticker ? instrumentKeyForTicker(ticker, instrumentRows) : null,
    documentKey: 'monthly-account',
    date: movement.date,
    type: movement.type,
    quantity: movement.quantity,
    unitPrice: movement.unitPrice,
    grossAmount: movement.grossAmount,
    netAmount: movement.netAmount,
    fees: movement.fees,
    taxes: movement.taxes,
    currency: movement.currency,
    fxRate: movement.fxRate,
    sourceReference: movement.sourceReference,
  }
}

function actionRow(
  action: ReturnType<typeof adaptMonthlyAccount>['corporateActions'][number],
  ticker: string,
  instrumentRows: readonly ImportInstrumentRow[],
): ImportCorporateActionRow {
  return {
    instrumentKey: instrumentKeyForTicker(ticker, instrumentRows),
    documentKey: 'monthly-account',
    date: action.date,
    type: action.type,
    quantityBefore: action.quantityBefore,
    quantityChange: action.quantityChange,
    quantityAfter: action.quantityAfter,
    ratio: action.ratio,
    description: action.description,
  }
}

function instrumentKeyForTicker(ticker: string, instrumentRows: readonly ImportInstrumentRow[]): string {
  const matches = instrumentRows.filter((row) => row.ticker === ticker)
  if (matches.length !== 1) {
    throw new ImportPeriodValidationError(`No hay un instrumento único para ${ticker}.`)
  }
  const match = matches[0]
  if (!match) {
    throw new ImportPeriodValidationError(`No hay un instrumento único para ${ticker}.`)
  }
  return match.key
}

function instrumentKey(ticker: string, category: InstrumentCategory | string): string {
  return `${ticker}|${category}`
}

function sameCash(stored: readonly CashBalance[], incoming: readonly CashBalance[]): boolean {
  if (stored.length !== incoming.length) return false
  const incomingByCurrency = new Map(incoming.map((balance) => [balance.currency, balance]))
  return stored.every((balance) => {
    const other = incomingByCurrency.get(balance.currency)
    return (
      other !== undefined &&
      sameMoney(balance.amount, other.amount) &&
      sameMoney(balance.fxRate, other.fxRate) &&
      sameMoney(balance.valueInBaseCurrency, other.valueInBaseCurrency)
    )
  })
}

function sameMoney(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right
  return parseDecimal(left).eq(right)
}
