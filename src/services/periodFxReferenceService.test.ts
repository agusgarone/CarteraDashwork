import { describe, expect, it, vi } from 'vitest'
import type { CashBalance, PortfolioSnapshot } from '../domain/snapshot'
import type { PortfolioPeriod } from '../domain/period'
import type { PortfolioDocument } from '../domain/document'
import { createPeriodFxReferenceService } from './periodFxReferenceService'

function world() {
  const period: PortfolioPeriod = { id: 'january', portfolioId: 'portfolio', year: 2026, month: 1, status: 'COMPLETE', createdAt: '', completedAt: '' }
  const closing: PortfolioSnapshot = { id: 'close', portfolioId: 'portfolio', periodId: period.id, date: '2026-01-30', totalValue: '100', currency: 'ARS', sourceDocumentId: 'pdf', createdAt: '' }
  const document: PortfolioDocument = { id: 'pdf', periodId: period.id, type: 'CONSOLIDATED_POSITION', originalFilename: 'arbitrary.pdf', localPath: 'documents/closing.pdf', sha256: 'document-hash', processingStatus: 'PROCESSED', parserVersion: 'balanz-v1', createdAt: '' }
  const balance: CashBalance = { id: 'mep', snapshotId: 'close', currency: 'USD_MEP', amount: '10', fxRate: '1464.7500', valueInBaseCurrency: '14647.5' }
  const portfolio = { id: 'portfolio', name: 'Cartera', broker: 'BALANZ', baseCurrency: 'ARS' as const, createdAt: '' }
  const dependencies = {
    periods: { getById: vi.fn(async (): Promise<PortfolioPeriod | null> => period) },
    portfolios: { getById: vi.fn(async () => portfolio) },
    snapshots: {
      getLatestByPeriod: vi.fn(async (): Promise<PortfolioSnapshot | null> => closing),
      getCashBalances: vi.fn(async (): Promise<CashBalance[]> => [balance]),
    },
    documents: { getById: vi.fn(async (): Promise<PortfolioDocument | null> => document) },
  }
  return { period, closing, document, balance, portfolio, dependencies, service: createPeriodFxReferenceService(dependencies) }
}

describe('referencia mensual explícita USD MEP', () => {
  it('devuelve fecha real, precisión original y procedencia del documento de cierre', async () => {
    const w = world()
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toEqual({
      status: 'AVAILABLE', periodId: 'january', currency: 'USD_MEP', rate: '1464.7500', date: '2026-01-30', snapshotId: 'close',
      source: { kind: 'EXPLICIT_SNAPSHOT_RATE', broker: 'BALANZ', documentId: 'pdf', documentType: 'CONSOLIDATED_POSITION',
        originalFilename: 'arbitrary.pdf', localPath: 'documents/closing.pdf', sha256: 'document-hash', parserVersion: 'balanz-v1',
        cashBalanceId: 'mep', field: 'cash_balances.fx_rate', documentField: 'Tipo de cambio: MEP' },
    })
    expect(w.dependencies.snapshots.getLatestByPeriod).toHaveBeenCalledWith('january')
    expect(w.dependencies.snapshots.getCashBalances).toHaveBeenCalledWith('close')
    expect(w.dependencies.documents.getById).toHaveBeenCalledWith('pdf')
  })
  it('acepta cotización explícita con saldo USD igual a cero', async () => {
    const w = world()
    w.balance.amount = '0'
    w.balance.valueInBaseCurrency = '0'
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'AVAILABLE', rate: '1464.7500' })
  })
  it('no deriva la cotización dividiendo valuación por saldo', async () => {
    const w = world()
    w.balance.fxRate = null
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'MISSING_EXPLICIT_USD_MEP_RATE' })
  })
  it('no reemplaza MEP por CCL', async () => {
    const w = world()
    w.balance.currency = 'USD_CABLE'
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'MISSING_USD_MEP_BALANCE' })
  })
  it.each(['0', '-10', 'NaN', 'Infinity', 'no-rate'])('rechaza FX inválido %s sin excepción genérica', async rate => {
    const w = world()
    w.balance.fxRate = rate
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'INVALID_USD_MEP_RATE' })
  })
  it('no toma un snapshot del mes anterior', async () => {
    const w = world()
    w.closing.date = '2025-12-30'
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'CLOSING_SNAPSHOT_OUTSIDE_PERIOD' })
  })
  it('devuelve motivo explícito para un período inexistente o todavía no importado', async () => {
    const w = world()
    w.dependencies.periods.getById.mockResolvedValueOnce(null)
    expect(await w.service.getPeriodUsdMepReference('missing')).toMatchObject({ status: 'UNAVAILABLE', reason: 'PERIOD_NOT_FOUND' })
    w.period.status = 'PENDING'
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'PERIOD_NOT_IMPORTED' })
  })
  it('no busca una referencia alternativa si falta el cierre', async () => {
    const w = world()
    w.dependencies.snapshots.getLatestByPeriod.mockResolvedValueOnce(null)
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'CLOSING_SNAPSHOT_NOT_FOUND' })
    expect(w.dependencies.snapshots.getCashBalances).not.toHaveBeenCalled()
  })
  it('exige documento de posición consolidada procesado', async () => {
    const w = world()
    w.document.type = 'PERIOD_RESULTS'
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'SNAPSHOT_SOURCE_UNAVAILABLE' })
    w.closing.sourceDocumentId = null
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'SNAPSHOT_SOURCE_UNAVAILABLE' })
  })
  it('rechaza múltiples balances MEP ambiguos', async () => {
    const w = world()
    w.dependencies.snapshots.getCashBalances.mockResolvedValueOnce([w.balance, { ...w.balance, id: 'duplicate' }])
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'AMBIGUOUS_USD_MEP_BALANCE' })
  })
  it('no publica referencias de una cartera que no sea Balanz', async () => {
    const w = world()
    w.portfolio.broker = 'OTHER'
    expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'UNSUPPORTED_PORTFOLIO' })
  })
})