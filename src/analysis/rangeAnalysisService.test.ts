import type { CorporateAction } from '../domain/corporateAction'
import Decimal from 'decimal.js'
import { describe, expect, it, vi } from 'vitest'
import type { PortfolioPeriod } from '../domain/period'
import type { PortfolioSnapshot, Position } from '../domain/snapshot'
import type { Transaction } from '../domain/transaction'
import { resolveAnalysisRange } from './analysisRange'
import { createRangeAnalysisService } from './rangeAnalysisService'
import { createPeriodAnalysisService } from '../engine/services/periodAnalysisService'
import { calculateModifiedDietz } from '../engine/calculations/modifiedDietz'

const periods: PortfolioPeriod[] = Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1), portfolioId: 'p', year: 2026, month: index + 1, status: 'COMPLETE', createdAt: '', completedAt: '' }))

describe('selección de rangos por calendario', () => {
  it.each([['SINGLE', [8]], ['LAST_3', [6,7,8]], ['LAST_6', [3,4,5,6,7,8]], ['YTD', [1,2,3,4,5,6,7,8]]] as const)('%s resuelve los períodos importados exactos', (mode, months) => {
    const result = resolveAnalysisRange(periods, { mode, endPeriodId: '8' })
    expect(result.status).toBe('AVAILABLE')
    if (result.status === 'AVAILABLE') expect(result.periods.map(row => row.month)).toEqual([...months])
  })
  it('12M no se reduce a ocho meses ni inventa cuatro períodos', () => {
    expect(resolveAnalysisRange(periods, { mode: 'LAST_12', endPeriodId: '8' })).toMatchObject({ status: 'INCOMPLETE_RANGE', missingPeriods: ['2025-09','2025-10','2025-11','2025-12'] })
  })
  it('detecta meses faltantes en el medio y períodos incompletos excluidos del catálogo', () => {
    expect(resolveAnalysisRange(periods.filter(row => row.month !== 3), { mode: 'CUSTOM', customStartPeriodId: '1', endPeriodId: '4' })).toMatchObject({ status: 'INCOMPLETE_RANGE', missingPeriods: ['2026-03'] })
  })
  it('personalizado permite un solo mes y rechaza inicio posterior al final', () => {
    expect(resolveAnalysisRange(periods, { mode: 'CUSTOM', customStartPeriodId: '7', endPeriodId: '7' })).toMatchObject({ status: 'AVAILABLE', periods: [periods[6]] })
    expect(resolveAnalysisRange(periods, { mode: 'CUSTOM', customStartPeriodId: '8', endPeriodId: '7' })).toMatchObject({ status: 'UNAVAILABLE', reason: 'START_AFTER_END' })
  })
  it('cambiar el final recalcula presets y conserva el inicio personalizado', () => {
    const preset = resolveAnalysisRange(periods, { mode: 'LAST_3', endPeriodId: '7' })
    expect(preset.status === 'AVAILABLE' && preset.periods.map(row => row.month)).toEqual([5,6,7])
    const custom = resolveAnalysisRange(periods, { mode: 'CUSTOM', customStartPeriodId: '3', endPeriodId: '7' })
    expect(custom.status === 'AVAILABLE' && custom.range).toEqual({ startPeriodId: '3', endPeriodId: '7' })
  })
})

function world() {
  const selected = periods.slice(6)
  const snapshots: PortfolioSnapshot[] = [
    { id: 'june-close', periodId: '6', portfolioId: 'p', date: '2026-06-30', totalValue: '23007361', currency: 'ARS', sourceDocumentId: null, createdAt: '' },
    { id: 'july-close', periodId: '7', portfolioId: 'p', date: '2026-07-31', totalValue: '25954029', currency: 'ARS', sourceDocumentId: null, createdAt: '' },
    { id: 'august-close', periodId: '8', portfolioId: 'p', date: '2026-08-31', totalValue: '26383988', currency: 'ARS', sourceDocumentId: null, createdAt: '' },
  ]
  const flow = (id: string, periodId: string, date: string, type: Transaction['type'], amount: string): Transaction => ({ id, portfolioId: 'p', periodId, date, type, instrumentId: null, quantity: null, unitPrice: null, grossAmount: amount, netAmount: amount, fees: null, taxes: null, currency: 'ARS', fxRate: null, sourceDocumentId: null, sourceReference: null, createdAt: '' })
  const transactions = [flow('july-contribution', '7', '2026-07-02', 'CONTRIBUTION', '1800000'), flow('august-contribution', '8', '2026-08-03', 'CONTRIBUTION', '1250000'), flow('august-withdrawal', '8', '2026-08-18', 'WITHDRAWAL', '1000000')]
  const deps = {
    periods: { getById: vi.fn(async (id: string) => selected.find(row => row.id === id) ?? null), getByPortfolio: vi.fn(async () => selected) },
    snapshots: { getLatestBefore: vi.fn(async (_portfolioId: string, date: string) => snapshots.filter(row => row.date < date).at(-1) ?? null), getLatestByPeriod: vi.fn(async (id: string) => snapshots.find(row => row.periodId === id) ?? null), getPositions: vi.fn(async (): Promise<Position[]> => []) },
    transactions: { getByPeriod: vi.fn(async (id: string) => transactions.filter(row => row.periodId === id)) },
    corporateActions: { getByPeriod: vi.fn(async (): Promise<CorporateAction[]> => []) },
    getUsdReference: vi.fn(async (periodId: string) => ({ status: 'UNAVAILABLE' as const, periodId, currency: 'USD_MEP' as const, reason: 'MISSING_USD_MEP_BALANCE' as const })),
  }
  return { deps, transactions, snapshots, service: createRangeAnalysisService(deps) }
}

describe('una sola ventana económica', () => {
  it('Julio→Agosto usa extremos y todos los flujos con sus fechas reales', async () => {
    const w = world()
    const result = await w.service.analyzeRange({ startPeriodId: '7', endPeriodId: '8' })
    expect(result.status).toBe('AVAILABLE')
    if (result.status !== 'AVAILABLE') return
    expect(result.base).toEqual({ openingValue: '23007361.00', closingValue: '26383988.00', contributions: '3050000.00', withdrawals: '1000000.00', netContributions: '2050000.00', investmentResult: new Decimal('26383988').minus('23007361').minus('3050000').plus('1000000').toFixed(2) })
    expect(result.openingSnapshot.id).toBe('june-close')
    expect(result.closingSnapshot.id).toBe('august-close')
    expect(result.durationDays).toBe(62)
    expect(result.periodReturn.externalFlows.map(row => row.transactionId)).toEqual(w.transactions.map(row => row.id))
    const july = calculateModifiedDietz({ investmentResult: '1146668', openingValue: '23007361', openingDate: '2026-06-30', closingDate: '2026-07-31', transactions: [w.transactions[0]!] })
    const august = calculateModifiedDietz({ investmentResult: '179959', openingValue: '25954029', openingDate: '2026-07-31', closingDate: '2026-08-31', transactions: w.transactions.slice(1) })
    expect(result.periodReturn.returnDecimal).not.toBe(new Decimal(july.returnDecimal!).plus(august.returnDecimal!).toFixed(28))
    expect(result.attribution.status).toBe('PENDING')
    expect(w.deps.getUsdReference).toHaveBeenCalledExactlyOnceWith('8')
    expect(result.usdReference.status).toBe('UNAVAILABLE')
  })
  it('un rango de un mes equivale al cálculo mensual sin alterar las convenciones', async () => {
    const w = world()
    const monthly = await createPeriodAnalysisService(w.deps).analyzePeriod('7')
    const range = await w.service.analyzeRange({ startPeriodId: '7', endPeriodId: '7' })
    expect(range.status).toBe('AVAILABLE')
    if (range.status !== 'AVAILABLE') return
    expect(range.base).toEqual(monthly)
    expect(range.periodReturn).toEqual(calculateModifiedDietz({ investmentResult: monthly.investmentResult, openingValue: monthly.openingValue, openingDate: '2026-06-30', closingDate: '2026-07-31', transactions: [w.transactions[0]!] }))
  })
  it('no duplica flujos con el mismo id persistido', async () => {
    const w = world()
    w.transactions.push({ ...w.transactions[0]! })
    const result = await w.service.analyzeRange({ startPeriodId: '7', endPeriodId: '8' })
    expect(result.status === 'AVAILABLE' && result.base.contributions).toBe('3050000.00')
  })
  it('mantiene precisión Decimal por encima de enteros seguros de JS', async () => {
    const w = world()
    w.snapshots[0]!.totalValue = '9007199254740993.50'
    w.snapshots[2]!.totalValue = '9007199254741000.75'
    w.transactions.splice(0)
    const result = await w.service.analyzeRange({ startPeriodId: '7', endPeriodId: '8' })
    expect(result.status === 'AVAILABLE' && result.base.investmentResult).toBe('7.25')
  })
  it('incluye instrumentos con ciclo completo sin inventar posiciones', async () => {
    const w = world()
    w.transactions.push({ ...w.transactions[0]!, id: 'buy', instrumentId: 'al30', type: 'BUY', quantity: '2' }, { ...w.transactions[0]!, id: 'sell', instrumentId: 'al30', type: 'SELL', quantity: '-2' })
    const result = await w.service.analyzeRange({ startPeriodId: '7', endPeriodId: '8' })
    expect(result.status === 'AVAILABLE' && result.instrumentUniverse).toContainEqual({ instrumentId: 'al30', presentAtOpening: false, presentAtClosing: false, hasTransactions: true, hasCorporateActions: false, completeTradeCycle: true })
  })
})
describe('integridad de la ventana', () => {
  it('rechaza una cadena que no comparte el snapshot intermedio', async () => {
    const w = world()
    w.deps.snapshots.getLatestBefore.mockImplementation(async (_portfolioId, date) => date === '2026-08-01' ? { ...w.snapshots[1]!, id: 'other-july' } : w.snapshots[0]!)
    expect(await w.service.analyzeRange({ startPeriodId: '7', endPeriodId: '8' })).toMatchObject({ status: 'UNAVAILABLE', reason: 'BROKEN_SNAPSHOT_CHAIN' })
  })
  it('rechaza operaciones fuera de las fechas reales del rango', async () => {
    const w = world()
    w.transactions[0]!.date = '2026-06-29'
    expect(await w.service.analyzeRange({ startPeriodId: '7', endPeriodId: '8' })).toMatchObject({ status: 'UNAVAILABLE', reason: 'TRANSACTION_OUTSIDE_RANGE' })
  })
  it('incluye instrumentos presentes solamente en corporate actions', async () => {
    const w = world()
    w.deps.corporateActions.getByPeriod.mockResolvedValue([{ id: 'action', portfolioId: 'p', periodId: '7', instrumentId: 'corporate-only', date: '2026-07-03', type: 'OTHER', quantityBefore: null, quantityChange: null, quantityAfter: null, ratio: null, description: null, sourceDocumentId: null, createdAt: '' }])
    const result = await w.service.analyzeRange({ startPeriodId: '7', endPeriodId: '8' })
    expect(result.status === 'AVAILABLE' && result.instrumentUniverse).toContainEqual({ instrumentId: 'corporate-only', presentAtOpening: false, presentAtClosing: false, hasTransactions: false, hasCorporateActions: true, completeTradeCycle: false })
  })
  it('el servicio reporta un mes intermedio faltante antes de consultar snapshots', async () => {
    const w = world()
    w.deps.periods.getByPortfolio.mockResolvedValue([periods[5]!, periods[7]!])
    w.deps.periods.getById.mockImplementation(async id => periods.find(row => row.id === id) ?? null)
    expect(await w.service.analyzeRange({ startPeriodId: '6', endPeriodId: '8' })).toMatchObject({ status: 'INCOMPLETE_RANGE', missingPeriods: ['2026-07'] })
    expect(w.deps.snapshots.getLatestBefore).not.toHaveBeenCalled()
  })
})
