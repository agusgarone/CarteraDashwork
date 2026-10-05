import path from 'node:path'
import { rm } from 'node:fs/promises'
import type { DatabaseClient } from '../database/client'
import type { EntityId } from '../domain/common'
import type { InstrumentCategory } from '../domain/instrument'
import { ENGINE_VERSION } from '../engine/version'
import type { PeriodPerformanceAnalysis } from '../engine/models/periodPerformance'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createPeriodAnalysisService } from '../engine/services/periodAnalysisService'
import type { ParsedConsolidatedPosition } from '../parsers/models/parsedConsolidatedPosition'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createDocumentRepository } from '../repositories/documentRepository'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createReconciliationRepository } from '../repositories/reconciliationRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { adaptConsolidatedPosition } from './adapters/consolidatedPositionAdapter'
import { adaptMonthlyAccount } from './adapters/monthlyAccountAdapter'
import { publishDocument, removePublished } from './documentStore'
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
  type PreparedFile,
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
  analysis: PeriodPerformanceAnalysis
}

export interface ImportPeriodService {
  importPeriod(input: ImportPeriodInput): Promise<ImportPeriodResult>
}

export interface ImportPeriodServiceOptions {
  db: DatabaseClient
  appDataDir: string
  now?: () => string
  /** Se ejecuta después de copiar los archivos y antes de la transacción. Los tests lo usan para forzar un fallo. */
  beforePersist?: () => Promise<void> | void
}

/**
 * Documentos ya elegidos → parseo → validación → una transacción → motor leyendo SQLite.
 *
 * La base y el disco no comparten una transacción. Si el insert falla, se borran solo
 * los archivos que este intento creó. El original del usuario no se mueve.
 * La corrida de reconciliación se escribe después del COMMIT. Si ese segundo insert
 * falla, un reintento del mismo set la completa sin duplicar documentos: el hash sigue siendo único.
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

      const stagingDir = path.join(options.appDataDir, 'staging')
      const createdFiles: string[] = []
      let persisted = false
      try {
        const prepared = await prepareImportPeriod(input.files, stagingDir)
        await rememberExistingDocuments(prepared, input.portfolioId)
        const reusedOpeningId = await resolveOpening(prepared, input.portfolioId)
        await assertPeriodIsNewOrSameFiles(prepared, input.portfolioId)

        const alreadyImported = await existingImport(prepared, input.portfolioId, reusedOpeningId)
        if (alreadyImported) {
          const analysis = await analyzeFromDatabase(db, alreadyImported.periodId)
          await ensureReconciliation(alreadyImported.periodId, analysis)
          return { outcome: 'existing', ...alreadyImported, analysis }
        }

        for (const file of prepared.files) {
          if (file.existingDocumentId) continue
          const published = await publishDocument(options.appDataDir, file.relativePath, file.stagedPath)
          if (published.created) createdFiles.push(file.relativePath)
        }

        await options.beforePersist?.()
        const plan = await buildPlan(prepared, input.portfolioId, reusedOpeningId, options.now?.() ?? new Date().toISOString())
        const saved = await persistImportPlan(db, plan)
        persisted = true
        const analysis = await analyzeFromDatabase(db, saved.closingPeriodId)
        await ensureReconciliation(saved.closingPeriodId, analysis)
        return {
          outcome: 'imported',
          periodId: saved.closingPeriodId,
          openingSnapshotId: saved.openingSnapshotId,
          closingSnapshotId: saved.closingSnapshotId,
          analysis,
        }
      } catch (error) {
        if (!persisted) {
          await Promise.all(createdFiles.map((relativePath) => removePublished(options.appDataDir, relativePath)))
        }
        throw error
      } finally {
        await rm(stagingDir, { recursive: true, force: true })
      }
    },
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
    if (prepared.opening) {
      await assertSnapshotHash(portfolioId, prepared.opening.position.snapshotDate, prepared.opening.file)
      const snapshot = await snapshots.getByDate(portfolioId, prepared.opening.position.snapshotDate)
      return snapshot?.id ?? null
    }
    const existing = await snapshots.getLatestBefore(portfolioId, prepared.account.parsed.period.startDate)
    if (!existing) {
      throw new ImportPeriodValidationError('Falta la posición de apertura y no hay un snapshot anterior.')
    }
    return existing.id
  }

  async function assertSnapshotHash(portfolioId: EntityId, date: string, file: PreparedFile): Promise<void> {
    const snapshot = await snapshots.getByDate(portfolioId, date)
    if (!snapshot) return
    if (!snapshot.sourceDocumentId) {
      throw new ImportConflictError(`Ya hay un snapshot el ${date} sin documento de origen.`)
    }
    const source = await documents.getById(snapshot.sourceDocumentId)
    if (!source || source.sha256 !== file.sha256) {
      throw new ImportConflictError(`Ya hay otro documento para el snapshot ${date}.`)
    }
  }

  async function assertPeriodIsNewOrSameFiles(prepared: PreparedImport, portfolioId: EntityId): Promise<void> {
    await assertSnapshotHash(portfolioId, prepared.closing.position.snapshotDate, prepared.closing.file)
    const period = await periods.getByYearMonth(portfolioId, prepared.closingPeriod.year, prepared.closingPeriod.month)
    const sameFiles = prepared.files.every((file) => file.existingDocumentId)
    if (period?.status === 'COMPLETE' && !sameFiles) {
      throw new ImportConflictError('El período ya fue importado con otros documentos.')
    }
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

  async function ensureReconciliation(periodId: EntityId, analysis: PeriodPerformanceAnalysis): Promise<void> {
    const latest = await reconciliations.getLatestByPeriod(periodId)
    if (latest) return
    await reconciliations.create({
      periodId,
      openingValue: analysis.base.openingValue,
      closingValue: analysis.base.closingValue,
      contributions: analysis.base.contributions,
      withdrawals: analysis.base.withdrawals,
      expectedResult: analysis.performance.expectedResult,
      explainedResult: analysis.performance.explainedResult,
      difference: analysis.performance.unexplainedDifference,
      status: reconciliationStatus(analysis),
      engineVersion: ENGINE_VERSION,
    })
  }

  async function buildPlan(
    prepared: PreparedImport,
    portfolioId: EntityId,
    reusedOpeningId: EntityId | null,
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
        snapshotRow('closing', 'closing', prepared.closing, closingAdapted.cashBalances, null),
      ],
      transactions: movements.transactions.map((movement, index) =>
        transactionRow(movement, prepared.account.parsed.transactions[index]?.ticker ?? null, instrumentRows),
      ),
      corporateActions: movements.corporateActions.map((action, index) =>
        actionRow(action, prepared.account.parsed.corporateActions[index]?.ticker ?? '', instrumentRows),
      ),
    }
  }
}

async function analyzeFromDatabase(db: DatabaseClient, periodId: EntityId): Promise<PeriodPerformanceAnalysis> {
  const periods = createPeriodRepository(db)
  const snapshots = createSnapshotRepository(db)
  const transactions = createTransactionRepository(db)
  const corporateActions = createCorporateActionRepository(db)
  const service = createPerformanceAnalysisService({
    analysis: createPeriodAnalysisService({ periods, snapshots, transactions }),
    periods,
    snapshots,
    transactions,
    corporateActions,
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
