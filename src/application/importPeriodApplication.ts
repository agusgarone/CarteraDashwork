import type { DatabaseClient } from '../database/client'
import type { ReconciliationStatus } from '../domain/reconciliation'
import type { DocumentType } from '../domain/document'
import type { ImportFileSystem } from '../import/documentStore'
import { fileNameOf } from '../import/documentStore'
import { createImportPeriodService } from '../import/importPeriodService'
import { reconciliationStatus } from '../import/reconciliationPolicy'
import { formatReturnPercent } from '../utils/formatPercentage'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createDocumentRepository } from '../repositories/documentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'

export interface ImportPeriodResultView {
  outcome: 'created' | 'existing'
  period: {
    id: string
    year: number
    month: number
    status: string
  }
  documents: {
    type: DocumentType
    fileName: string
    date: string
  }[]
  summary: {
    positionsCount: number
    transactionsCount: number
    corporateActionsCount: number
  }
  unsupportedInternalMovements: boolean
  cashLedgerReconciled: boolean
  positionAttributionPartial: boolean
  periodReturnLabel: string | null
  analysis: {
    expectedResult: string
    explainedResult: string | null
    unexplainedDifference: string | null
    reconciliationStatus: ReconciliationStatus | null
    unsupportedInternalMovements: boolean
  } | null
}

export async function importSelectedDocuments(options: {
  db: DatabaseClient
  appDataDir: string
  files: ImportFileSystem
  paths: string[]
  now?: () => string
}): Promise<ImportPeriodResultView> {
  const portfolios = createPortfolioRepository(options.db)
  const existing = await portfolios.getAll()
  const portfolio = existing[0] ?? await portfolios.create({
    name: 'Mi cartera',
    broker: 'BALANZ',
    baseCurrency: 'ARS',
  })
  const uniquePaths = [...new Set(options.paths)]
  const imported = await createImportPeriodService({
    db: options.db,
    appDataDir: options.appDataDir,
    files: options.files,
    now: options.now,
  }).importPeriod({
    portfolioId: portfolio.id,
    files: uniquePaths.map((originalPath) => ({
      originalPath,
      originalFileName: fileNameOf(originalPath),
    })),
  })

  const periods = createPeriodRepository(options.db)
  const documents = createDocumentRepository(options.db)
  const snapshots = createSnapshotRepository(options.db)
  const transactions = createTransactionRepository(options.db)
  const corporateActions = createCorporateActionRepository(options.db)
  const period = await periods.getById(imported.periodId)
  if (!period) {
    throw new Error('El período importado no se puede leer.')
  }
  const storedTransactions = await transactions.getByPeriod(period.id)
  const closing = await snapshots.getAggregate(imported.closingSnapshotId)
  const opening = await snapshots.getAggregate(imported.openingSnapshotId)
  const listed = new Map<string, { type: DocumentType; fileName: string; date: string }>()
  const rows = [
    ...(opening ? await documents.getByPeriod(opening.snapshot.periodId) : []),
    ...(await documents.getByPeriod(period.id)),
  ]
  for (const document of rows) {
    const date = document.id === opening?.snapshot.sourceDocumentId
      ? opening.snapshot.date
      : closing?.snapshot.date ?? ''
    listed.set(document.id, {
      type: document.type,
      fileName: document.originalFilename,
      date,
    })
  }

  const cashLedgerReconciled = imported.analysis?.performance.cash.status === 'CASH_LEDGER_RECONCILED'
  const positionAttributionPartial = imported.analysis?.performance.partialExplainedResult != null
  const attributionPending = imported.analysis?.performance.attributionStatus === 'PENDING'
  const periodReturn =
    imported.analysis?.periodReturn.status === 'CALCULATED'
      ? imported.analysis.periodReturn.returnDecimal
      : null

  return {
    outcome: imported.outcome === 'existing' ? 'existing' : 'created',
    period: {
      id: period.id,
      year: period.year,
      month: period.month,
      status: period.status,
    },
    documents: [...listed.values()].sort((left, right) => left.date.localeCompare(right.date) || left.type.localeCompare(right.type)),
    summary: {
      positionsCount: closing?.positions.length ?? 0,
      transactionsCount: storedTransactions.length,
      corporateActionsCount: (await corporateActions.getByPeriod(period.id)).length,
    },
    unsupportedInternalMovements:
      hasInternalMovements(storedTransactions.map((movement) => movement.type)) && !cashLedgerReconciled,
    cashLedgerReconciled,
    positionAttributionPartial,
    periodReturnLabel: periodReturn ? formatReturnPercent(periodReturn) : null,
    analysis: imported.analysis
      ? {
          expectedResult: imported.analysis.performance.expectedResult,
          explainedResult: attributionPending ? null : imported.analysis.performance.explainedResult,
          unexplainedDifference: attributionPending ? null : imported.analysis.performance.unexplainedDifference,
          reconciliationStatus: attributionPending ? null : reconciliationStatus(imported.analysis),
          unsupportedInternalMovements:
            imported.analysis.performance.cash.status === 'HAS_INTERNAL_CASH_MOVEMENTS',
        }
      : null,
  }
}

const INTERNAL_MOVEMENT_TYPES = new Set([
  'BUY',
  'SELL',
  'FUND_SUBSCRIPTION',
  'FUND_REDEMPTION',
  'FX_CONVERSION',
])

function hasInternalMovements(types: readonly string[]): boolean {
  return types.some((type) => INTERNAL_MOVEMENT_TYPES.has(type))
}
