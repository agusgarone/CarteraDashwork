import type { EntityId } from '../domain/common'
import type { PeriodFxReference, PeriodFxReferenceUnavailableReason } from '../domain/periodFxReference'
import { parseDecimal } from '../engine/money'
import { documentRepository, type DocumentRepository } from '../repositories/documentRepository'
import { periodRepository, type PeriodRepository } from '../repositories/periodRepository'
import { portfolioRepository, type PortfolioRepository } from '../repositories/portfolioRepository'
import { snapshotRepository, type SnapshotRepository } from '../repositories/snapshotRepository'

export interface PeriodFxReferenceDependencies {
  periods: Pick<PeriodRepository, 'getById'>
  portfolios: Pick<PortfolioRepository, 'getById'>
  snapshots: Pick<SnapshotRepository, 'getLatestByPeriod' | 'getCashBalances'>
  documents: Pick<DocumentRepository, 'getById'>
}

export interface PeriodFxReferenceService {
  getPeriodUsdMepReference(periodId: EntityId): Promise<PeriodFxReference>
}

/** Read-only resolver. No rate inference, prior-month lookup, transaction FX or CCL fallback. */
export function createPeriodFxReferenceService(dependencies: PeriodFxReferenceDependencies): PeriodFxReferenceService {
  return {
    async getPeriodUsdMepReference(periodId) {
      const unavailable = (reason: PeriodFxReferenceUnavailableReason): PeriodFxReference => ({
        status: 'UNAVAILABLE', periodId, currency: 'USD_MEP', reason,
      })
      const period = await dependencies.periods.getById(periodId)
      if (!period) return unavailable('PERIOD_NOT_FOUND')
      if (period.status !== 'COMPLETE') return unavailable('PERIOD_NOT_IMPORTED')
      const portfolio = await dependencies.portfolios.getById(period.portfolioId)
      if (!portfolio || portfolio.broker !== 'BALANZ' || portfolio.baseCurrency !== 'ARS') return unavailable('UNSUPPORTED_PORTFOLIO')
      const closing = await dependencies.snapshots.getLatestByPeriod(periodId)
      if (!closing) return unavailable('CLOSING_SNAPSHOT_NOT_FOUND')
      const yearMonth = `${period.year}-${String(period.month).padStart(2, '0')}`
      if (closing.portfolioId !== period.portfolioId || closing.periodId !== periodId || closing.currency !== 'ARS'
        || closing.date.slice(0, 7) !== yearMonth) return unavailable('CLOSING_SNAPSHOT_OUTSIDE_PERIOD')
      if (!closing.sourceDocumentId) return unavailable('SNAPSHOT_SOURCE_UNAVAILABLE')
      const document = await dependencies.documents.getById(closing.sourceDocumentId)
      if (!document || document.type !== 'CONSOLIDATED_POSITION' || document.processingStatus !== 'PROCESSED') return unavailable('SNAPSHOT_SOURCE_UNAVAILABLE')
      const balances = (await dependencies.snapshots.getCashBalances(closing.id)).filter(row => row.currency === 'USD_MEP')
      if (balances.length === 0) return unavailable('MISSING_USD_MEP_BALANCE')
      if (balances.length !== 1) return unavailable('AMBIGUOUS_USD_MEP_BALANCE')
      const balance = balances[0]!
      if (balance.fxRate === null || balance.fxRate.trim() === '') return unavailable('MISSING_EXPLICIT_USD_MEP_RATE')
      try {
        if (!parseDecimal(balance.fxRate).gt('0')) return unavailable('INVALID_USD_MEP_RATE')
      } catch {
        return unavailable('INVALID_USD_MEP_RATE')
      }
      return {
        status: 'AVAILABLE', periodId, currency: 'USD_MEP', rate: balance.fxRate,
        date: closing.date, snapshotId: closing.id,
        source: {
          kind: 'EXPLICIT_SNAPSHOT_RATE', broker: 'BALANZ', documentId: document.id,
          documentType: 'CONSOLIDATED_POSITION', originalFilename: document.originalFilename,
          localPath: document.localPath, sha256: document.sha256, parserVersion: document.parserVersion,
          cashBalanceId: balance.id, field: 'cash_balances.fx_rate', documentField: 'Tipo de cambio: MEP',
        },
      }
    },
  }
}

export const periodFxReferenceService = createPeriodFxReferenceService({
  periods: periodRepository, portfolios: portfolioRepository,
  snapshots: snapshotRepository, documents: documentRepository,
})

export const getPeriodUsdMepReference = periodFxReferenceService.getPeriodUsdMepReference