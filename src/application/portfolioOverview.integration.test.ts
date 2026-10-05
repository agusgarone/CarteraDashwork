/// <reference types="node" />

import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Decimal from 'decimal.js'
import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { createNodeImportFiles } from '../import/nodeImportFiles'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { formatReturnPercent } from '../utils/formatPercentage'
import { importSelectedDocuments } from './importPeriodApplication'
import { loadPortfolioOverview } from './portfolioOverview'

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../parsers/balanz/fixtures/public',
)

const SOURCES = [
  ['consolidated-position-july2026-sanitized.txt', 'apertura.txt'],
  ['consolidated-position-august2026-sanitized.txt', 'cierre.txt'],
  ['august2026-sanitized.txt', 'cuenta.txt'],
  ['monthly-fund-statement-august2026-sanitized.txt', 'fondos.txt'],
] as const

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function importAugust() {
  const root = await mkdtemp(path.join(tmpdir(), 'cartera-overview-'))
  roots.push(root)
  const appData = path.join(root, 'app-data')
  const inputDir = path.join(root, 'entrada')
  await mkdir(appData, { recursive: true })
  await mkdir(inputDir, { recursive: true })
  const paths: string[] = []
  for (const [source, name] of SOURCES) {
    const destination = path.join(inputDir, name)
    await copyFile(path.join(FIXTURES, source), destination)
    paths.push(destination)
  }
  const database = openMemoryDatabase()
  await importSelectedDocuments({
    db: database.client,
    appDataDir: appData,
    files: createNodeImportFiles(),
    paths,
    now: () => '2026-10-05T18:00:00.000Z',
  })
  return database
}

function money(value: string, places = 2) {
  return new Decimal(value).toFixed(places)
}

describe('loadPortfolioOverview', () => {
  it('devuelve null si no hay períodos COMPLETE', async () => {
    const database = openMemoryDatabase()
    expect(await loadPortfolioOverview({ db: database.client })).toBeNull()

    const portfolios = createPortfolioRepository(database.client)
    const portfolio = await portfolios.create({ name: 'Mi cartera', broker: 'BALANZ', baseCurrency: 'ARS' })
    const periods = createPeriodRepository(database.client)
    const pending = await periods.create({ portfolioId: portfolio.id, year: 2026, month: 7, status: 'PENDING' })
    await createSnapshotRepository(database.client).createSnapshot({
      portfolioId: portfolio.id,
      periodId: pending.id,
      date: '2026-07-31',
      totalValue: '25954029',
      currency: 'ARS',
      sourceDocumentId: null,
    })
    expect(await loadPortfolioOverview({ db: database.client, periodId: pending.id })).toBeNull()
    database.close()
  })

  it('arma el resumen de agosto desde SQLite', async () => {
    const database = await importAugust()
    const view = await loadPortfolioOverview({ db: database.client })
    expect(view).not.toBeNull()
    if (!view) return

    expect(view.period).toMatchObject({ year: 2026, month: 8, label: 'Agosto 2026', status: 'COMPLETE' })
    expect(view.historicalContributedCapital).toBeNull()
    expect(view.contributedCapitalStatus).toBe('unavailable')
    expect(view.analysisNeedsRefresh).toBe(false)
    expect(view).not.toHaveProperty('returnPercentage')
    expect(JSON.stringify(view)).not.toContain('returnPercentage')

    expect(view.metrics.currentPortfolioValue).toBe('26383988')
    expect(money(view.metrics.openingPortfolioValue ?? '0')).toBe('25954029.00')
    expect(money(view.metrics.contributions ?? '0')).toBe('1250000.00')
    expect(money(view.metrics.withdrawals ?? '0')).toBe('1000000.00')
    expect(money(view.metrics.netContributions ?? '0')).toBe('250000.00')
    expect(view.metrics.investmentResult).toBe('179959.00')
    expect(view.metrics.explainedResult).toBe('179958.136')
    expect(view.metrics.unexplainedDifference).toBe('0.864')
    expect(view.metrics.reconciliationStatus).toBe('WARNING')
    expect(view.periodReturn).toMatchObject({ method: 'MODIFIED_DIETZ', status: 'CALCULATED' })
    expect(view.periodReturn?.decimal?.startsWith('0.006749211725')).toBe(true)
    expect(formatReturnPercent(view.periodReturn?.decimal ?? '0')).toBe('+0,67%')
    expect(formatReturnPercent(view.periodReturn?.decimal ?? '0')).not.toBe('+7,12%')
    expect(JSON.stringify(view)).not.toContain('+7,12%')
    expect(JSON.stringify(view)).not.toContain('7.12')

    const identity = new Decimal(view.metrics.openingPortfolioValue ?? '0')
      .plus(view.metrics.contributions ?? '0')
      .minus(view.metrics.withdrawals ?? '0')
      .plus(view.metrics.investmentResult ?? '0')
    expect(identity.eq(view.metrics.currentPortfolioValue)).toBe(true)

    expect(view.resultBreakdown?.positionValuation).toBe('171533.92')
    expect(money(view.resultBreakdown?.cashEconomicResult ?? '0', 4)).toBe('8424.2160')
    expect(money(view.resultBreakdown?.cash?.fxValuationChange ?? '0', 4)).toBe('3077.6256')
    const nested = new Decimal(view.resultBreakdown?.cash?.fxValuationChange ?? '0')
      .plus(view.resultBreakdown?.cash?.dividends ?? '0')
      .plus(view.resultBreakdown?.cash?.interest ?? '0')
      .minus(view.resultBreakdown?.cash?.fees ?? '0')
      .minus(view.resultBreakdown?.cash?.taxes ?? '0')
      .plus(view.resultBreakdown?.cash?.otherCashResult ?? '0')
    expect(nested.toFixed(4)).toBe(new Decimal(view.resultBreakdown?.cashEconomicResult ?? '0').toFixed(4))
    const explained = new Decimal(view.resultBreakdown?.positionValuation ?? '0')
      .plus(view.resultBreakdown?.cashEconomicResult ?? '0')
      .plus(view.metrics.unexplainedDifference ?? '0')
    expect(explained.toFixed(2)).toBe('179959.00')

    const byLabel = new Map(view.allocation.map((item) => [item.label, item.marketValue]))
    expect(money(byLabel.get('Acciones') ?? '0')).toBe('2532860.00')
    expect(money(byLabel.get('CEDEARs') ?? '0')).toBe('11767245.00')
    expect(money(byLabel.get('Obligaciones negociables') ?? '0')).toBe('6847066.00')
    expect(money(byLabel.get('Fondos') ?? '0')).toBe('4674434.08')
    expect(money(byLabel.get('Liquidez') ?? '0', 4)).toBe('562383.0962')
    expect(view.allocation.some((item) => item.id === 'OTHER' && item.label === 'Diferencia')).toBe(false)
    expect(money(view.allocationResidual, 4)).toBe('-0.1762')

    const allocated = view.allocation.reduce((sum, item) => sum.plus(item.marketValue), new Decimal(0))
    expect(allocated.plus(view.allocationResidual).eq(view.metrics.currentPortfolioValue)).toBe(true)
    for (const item of view.allocation) {
      expect(item.weight).toBe(new Decimal(item.marketValue).div(view.metrics.currentPortfolioValue).toFixed(6))
    }

    expect(view.evolution.map((point) => point.label)).toEqual(['Jul', 'Ago'])
    expect(view.evolution.map((point) => point.portfolioValue)).toEqual(['25954029', '26383988'])
    expect(view.evolution.every((point) => !('contributedCapital' in point))).toBe(true)

    expect(view.months).toEqual([
      expect.objectContaining({
        label: 'Agosto 2026',
        investmentResult: '179959.00',
      }),
    ])
    expect(view.importStatus.documents.map((document) => [document.label, document.present])).toEqual([
      ['Posición apertura', true],
      ['Posición cierre', true],
      ['Resumen mensual', true],
      ['Resumen FCI', true],
    ])
    expect(JSON.stringify(view.importStatus)).not.toContain('sha256')
    expect(JSON.stringify(view.importStatus)).not.toContain('documents/')

    const july = await createPeriodRepository(database.client).getByYearMonth(
      (await createPortfolioRepository(database.client).getAll())[0]?.id ?? '',
      2026,
      7,
    )
    const selectedPending = await loadPortfolioOverview({ db: database.client, periodId: july?.id })
    expect(selectedPending?.period.month).toBe(8)

    const selectedAugust = await loadPortfolioOverview({ db: database.client, periodId: view.period.id })
    expect(selectedAugust?.period.id).toBe(view.period.id)

    const portfolios = createPortfolioRepository(database.client)
    const portfolio = (await portfolios.getAll())[0]
    const september = await createPeriodRepository(database.client).create({
      portfolioId: portfolio?.id ?? '',
      year: 2026,
      month: 9,
      status: 'COMPLETE',
    })
    await createSnapshotRepository(database.client).createSnapshot({
      portfolioId: portfolio?.id ?? '',
      periodId: september.id,
      date: '2026-09-30',
      totalValue: '27000000.00',
      currency: 'ARS',
      sourceDocumentId: null,
    })
    const latest = await loadPortfolioOverview({ db: database.client })
    expect(latest?.period.month).toBe(9)
    expect(latest?.metrics.currentPortfolioValue).toBe('27000000.00')
    const augustAgain = await loadPortfolioOverview({ db: database.client, periodId: view.period.id })
    expect(augustAgain?.metrics.investmentResult).toBe('179959.00')
    expect(augustAgain?.metrics.currentPortfolioValue).toBe('26383988')

    database.close()
  }, 60_000)
})
