/// <reference types="node" />

import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Decimal from 'decimal.js'
import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { createNodeImportFiles } from '../import/nodeImportFiles'
import { importSelectedDocuments } from './importPeriodApplication'
import { loadPortfolioDetail, visibleInstruments } from './portfolioDetail'

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

function money(value: string | null | undefined, places = 2) {
  return new Decimal(value ?? '0').toFixed(places)
}

describe('loadPortfolioDetail', () => {
  it('devuelve null sin un período COMPLETE', async () => {
    const database = openMemoryDatabase()
    expect(await loadPortfolioDetail({ db: database.client })).toBeNull()
    database.close()
  })

  it('arma el detalle de agosto desde SQLite', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cartera-detail-'))
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
    const imported = await importSelectedDocuments({
      db: database.client,
      appDataDir: appData,
      files: createNodeImportFiles(),
      paths,
      now: () => '2026-10-05T18:00:00.000Z',
    })

    const view = await loadPortfolioDetail({ db: database.client, periodId: imported.period.id })
    expect(view).not.toBeNull()
    if (!view) return

    expect(view.period).toMatchObject({ year: 2026, month: 8 })
    expect(view.instruments).toHaveLength(25)
    expect(view.totals.portfolioValue).toBe('26383988')
    expect(money(view.totals.investmentValue)).toBe('25821605.08')
    expect(view.totals.investmentValue).not.toBe(view.totals.portfolioValue)
    expect(money(view.totals.valuationChange)).toBe('171533.92')
    expect(JSON.stringify(view)).not.toContain('returnPercentage')
    expect(JSON.stringify(view)).not.toContain('MODIFIED_DIETZ')
    expect(JSON.stringify(view)).not.toContain('periodReturn')
    expect(JSON.stringify(view)).not.toContain('investedCapital')
    expect(JSON.stringify(view)).not.toContain('sha256')

    const meta = view.instruments.find((row) => row.ticker === 'META')
    const apple = view.instruments.find((row) => row.ticker === 'AAPL')
    const amazon = view.instruments.find((row) => row.ticker === 'AMZN')
    const ypfd = view.instruments.find((row) => row.ticker === 'YPFD')
    const acciones = view.instruments.find((row) => row.ticker === 'BCACCA')
    const retorno = view.instruments.find((row) => row.ticker === 'BRTA')

    expect(money(meta?.quantity, 0)).toBe('13')
    expect(money(meta?.openingValue)).toBe('475020.00')
    expect(money(meta?.currentValue)).toBe('496340.00')
    expect(money(meta?.valuationChange)).toBe('21320.00')
    expect(meta?.valuationStatus).toBe('EXPLAINED')
    expect(meta?.statusLabel).toBe('Explicado')

    expect(money(apple?.currentValue)).toBe('708960.00')
    expect(money(apple?.valuationChange)).toBe('28280.00')
    expect(money(amazon?.currentValue)).toBe('1021935.00')
    expect(money(amazon?.valuationChange)).toBe('-29123.00')

    expect(money(ypfd?.openingQuantity, 0)).toBe('14')
    expect(money(ypfd?.quantity, 0)).toBe('140')
    expect(ypfd?.openingQuantityDiffers).toBe(true)
    expect(money(ypfd?.openingValue)).toBe('1160600.00')
    expect(money(ypfd?.currentValue)).toBe('1155700.00')
    expect(money(ypfd?.valuationChange)).toBe('-4900.00')
    expect(ypfd?.valuationStatus).toBe('CORPORATE_ACTION_EXPLAINED')
    expect(ypfd?.statusLabel).toBe('Explicado · acción corporativa')
    expect(ypfd?.corporateActions).toEqual([
      expect.objectContaining({
        type: 'STOCK_DIVIDEND',
        typeLabel: 'Dividendo en acciones',
        date: '2026-08-04',
        quantityBefore: '14',
        quantityChange: '126',
        quantityAfter: '140',
      }),
    ])
    expect(ypfd?.movements.some((movement) => movement.type === 'BUY')).toBe(false)

    expect(acciones?.quantity).toBe('14860.792493')
    expect(acciones?.currentValue).toBe('2287732.22')
    expect(acciones?.provenance).toContain('Valor proveniente de Resumen FCI')
    expect(retorno?.quantity).toBe('3214.592773')
    expect(retorno?.currentValue).toBe('2386701.86')

    const funds = view.categories.find((category) => category.id === 'FUND')
    expect(money(funds?.closingValue)).toBe('4674434.08')
    expect(view.categories.map((category) => category.label)).toEqual(
      expect.arrayContaining(['Acciones', 'CEDEARs', 'Obligaciones negociables', 'Fondos']),
    )
    expect(view.categories.some((category) => category.label === 'Liquidez')).toBe(false)

    const cedears = visibleInstruments(view.instruments, { categoryId: 'CEDEAR', query: '', sort: 'currentValue' })
    expect(cedears.every((row) => row.categoryId === 'CEDEAR')).toBe(true)
    expect(cedears.some((row) => row.ticker === 'META')).toBe(true)
    expect(cedears.some((row) => row.ticker === 'YPFD')).toBe(false)
    expect(visibleInstruments(view.instruments, { categoryId: 'ALL', query: 'bcacca', sort: 'currentValue' })).toEqual([
      acciones,
    ])

    const latest = await loadPortfolioDetail({ db: database.client })
    expect(latest?.period.id).toBe(view.period.id)

    database.close()
  }, 60_000)
})
