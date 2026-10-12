/// <reference types="node" />

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { utils, write } from 'xlsx'
import { openMemoryDatabase } from '../../database/sqliteMemory'
import { assertPeriodResultsMatch, planTransactionFxEnrichments } from '../../import/enrichment/periodResultsEnrichment'
import { ImportPeriodValidationError } from '../../import/importPeriodErrors'
import { prepareImportPeriod } from '../../import/prepareImportPeriod'
import { createNodeImportFiles } from '../../import/nodeImportFiles'
import { createPortfolioRepository } from '../../repositories/portfolioRepository'
import { createTransactionFxRepository } from '../../repositories/transactionFxRepository'
import {
  isPeriodResultsWorkbook,
  normalizePeriodResultsCurrency,
  operationReferenceFromText,
  parseBalanzPeriodResults,
} from './periodResults'

const LOT_HEADERS = [
  'Cantidad', 'Descripcion', 'Fecha', 'Fecha Lote', 'Gastos', 'Moneda', 'Operacion',
  'Precio Compra', 'Ticker', 'Tipo', 'DolarCCL', 'DolarMEP', 'DolarOficial',
]
const REALIZED_HEADERS = [
  'Cantidad', 'Descripcion', 'Fecha', 'FechaCompra', 'Gastos', 'Moneda Compra', 'Moneda Venta',
  'Operacion Compra', 'Operacion Venta', 'Precio Compra', 'PrecioVenta', 'Ticker', 'Tipo',
  'Tipo Movimiento', 'Cupones', 'Dividendos', 'Intereses', 'MTMFuturos',
  'OperacionCompraDolarCCL', 'OperacionCompraDolarMEP', 'OperacionCompraDolarOficial',
  'OperacionVentaDolarCCL', 'OperacionVentaDolarMEP', 'OperacionVentaDolarOficial',
]

describe('Resultados del período', () => {
  it('detecta el xlsx por las hojas y no por el nombre', async () => {
    const bytes = workbook()
    expect(isPeriodResultsWorkbook(bytes)).toBe(true)
    expect(isPeriodResultsWorkbook(new Uint8Array([0x50, 0x4b, 0, 0]))).toBe(false)
    const directory = await mkdtemp(path.join(tmpdir(), 'resultados-'))
    const filePath = path.join(directory, 'notas.xlsx')
    await writeFile(filePath, bytes)
    await expect(prepareImportPeriod(
      [{ originalPath: filePath, originalFileName: 'notas.xlsx' }],
      path.join(directory, 'staging'),
      createNodeImportFiles(),
    )).rejects.toThrow(/resumen mensual/)
  })

  it('lee el período desde la fecha de lote y el boleto de la operación', () => {
    const parsed = parseBalanzPeriodResults(workbook())
    expect(parsed).toMatchObject({
      documentType: 'PERIOD_RESULTS',
      openingDate: '2026-06-30',
      closingDate: '2026-07-31',
      initialLotCount: 1,
      finalLotCount: 1,
    })
    const ypfd = parsed.selections.find((row) => row.operationReference === '7321989')
    const pamp = parsed.selections.find((row) => row.operationReference === '7321988')
    expect(ypfd).toMatchObject({
      side: 'BUY',
      date: '2026-07-03',
      quantity: '2',
      currency: 'USD_MEP',
      kind: 'MEP',
      rate: '1523.66',
      column: 'OperacionCompraDolarMEP',
      ticker: 'YPFD',
      sheet: 'resultados_por_realizado',
    })
    expect(pamp).toMatchObject({
      currency: 'USD_CABLE',
      kind: 'CCL',
      rate: '1572.71',
      column: 'OperacionCompraDolarCCL',
      ticker: 'PAMP',
    })
    expect(parsed.selections.find((row) => row.ticker === 'KO')).toMatchObject({
      side: 'INCOME',
      movementType: 'Dividendo',
      date: '2026-07-02',
      kind: 'CCL',
      rate: '1578.06',
      column: 'OperacionVentaDolarCCL',
    })
    expect(parsed.selections.filter((row) => row.movementType === 'Cupón').map((row) => row.ticker).sort()).toEqual(['GD30', 'GD35'])
    expect(operationReferenceFromText('Boleto / 7321989 / COMPRA / 1 / YPFD / usd')).toBe('7321989')
    expect(operationReferenceFromText('Boleto / 7321988 / COMPRA / 1 / PAMP / U$S')).toBe('7321988')
    expect(normalizePeriodResultsCurrency('Pesos')).toBe('ARS')
    expect(normalizePeriodResultsCurrency('Dólares')).toBe('USD_MEP')
    expect(normalizePeriodResultsCurrency('US Dollar (Cable)')).toBe('USD_CABLE')
    expect(normalizePeriodResultsCurrency('Dólares C.V. 7000')).toBe('USD_CABLE')
  })

  it('rechaza otro período y un tipo de cambio que no coincide', () => {
    const parsed = parseBalanzPeriodResults(workbook())
    expect(() => assertPeriodResultsMatch(parsed, { openingDate: '2026-06-30', closingDate: '2026-08-31' }))
      .toThrow(ImportPeriodValidationError)
    expect(() => parseBalanzPeriodResults(workbook({
      realized: [
        trade('YPFD', '7321989', 'Dólares', '1523.66', '1572.71'),
        trade('YPFD', '7321990', 'Dólares', '1500.00', '1572.71'),
      ],
    }))).toThrow(/no coincide/)
  })

  it('cruza el boleto y el ingreso sin crear otra operación', () => {
    const parsed = parseBalanzPeriodResults(workbook())
    const planned = planTransactionFxEnrichments(parsed, [
      { id: 'ypfd', type: 'BUY', date: '2026-07-03', ticker: 'YPFD', currency: 'USD_MEP', sourceReference: 'Boleto / 7321989 / COMPRA / 1 / YPFD / usd' },
      { id: 'pamp', type: 'BUY', date: '2026-07-03', ticker: 'PAMP', currency: 'USD_CABLE', sourceReference: 'Boleto / 7321988 / COMPRA / 1 / PAMP / U$S' },
      { id: 'ko', type: 'DIVIDEND', date: '2026-07-02', ticker: 'KO', currency: 'USD_CABLE', sourceReference: 'Dividendo en efectivo / KO' },
      { id: 'ko-ars', type: 'DIVIDEND', date: '2026-07-02', ticker: 'KO', currency: 'ARS', sourceReference: 'Dividendo en efectivo / KO' },
      { id: 'gd30', type: 'INTEREST', date: '2026-07-10', ticker: 'GD30', currency: 'USD_CABLE', sourceReference: 'Renta y Amortización / GD30' },
      { id: 'gd30-ars', type: 'INTEREST', date: '2026-07-10', ticker: 'GD30', currency: 'ARS', sourceReference: 'Renta y Amortización / GD30' },
      { id: 'gd35', type: 'INTEREST', date: '2026-07-10', ticker: 'GD35', currency: 'USD_CABLE', sourceReference: 'Renta / GD35' },
      { id: 'other', type: 'BUY', date: '2026-07-03', ticker: 'YPFD', currency: 'USD_MEP', sourceReference: 'Boleto / 999 / COMPRA / 1 / YPFD / usd' },
    ])
    expect(planned).toEqual([
      expect.objectContaining({ transactionId: 'ypfd', fxRate: '1523.66', fxKind: 'MEP', sourceColumn: 'OperacionCompraDolarMEP', operationReference: '7321989' }),
      expect.objectContaining({ transactionId: 'pamp', fxRate: '1572.71', fxKind: 'CCL', sourceColumn: 'OperacionCompraDolarCCL' }),
      expect.objectContaining({ transactionId: 'ko', fxRate: '1578.06', fxKind: 'CCL', sourceColumn: 'OperacionVentaDolarCCL' }),
      expect.objectContaining({ transactionId: 'gd30', fxRate: '1564.48', sourceSheet: 'resultados_por_realizado' }),
      expect.objectContaining({ transactionId: 'gd35', fxRate: '1564.48' }),
    ])
    expect(planned.some((row) => row.transactionId === 'other' || row.transactionId === 'ko-ars' || row.transactionId === 'gd30-ars')).toBe(false)
  })

  it('no duplica el enriquecimiento de la misma operación', async () => {
    const database = openMemoryDatabase()
    const portfolio = await createPortfolioRepository(database.client).create({
      name: 'Mi cartera',
      broker: 'BALANZ',
      baseCurrency: 'ARS',
    })
    await database.client.execute(
      `INSERT INTO periods (portfolio_id, year, month, status) VALUES ($1, 2026, 7, 'COMPLETE')`,
      [portfolio.id],
    )
    const period = await database.client.select<{ id: number }>('SELECT id FROM periods')
    await database.client.execute(
      `INSERT INTO documents (period_id, type, original_filename, local_path, sha256, processing_status)
       VALUES ($1, 'PERIOD_RESULTS', 'resultados.xlsx', 'documents/2026/07/abc-period-results.xlsx', 'abc', 'PROCESSED')`,
      [period[0]?.id],
    )
    await database.client.execute(
      `INSERT INTO transactions (portfolio_id, period_id, date, type, currency)
       VALUES ($1, $2, '2026-07-03', 'BUY', 'USD_MEP')`,
      [portfolio.id, period[0]?.id],
    )
    const document = await database.client.select<{ id: number }>('SELECT id FROM documents')
    const movement = await database.client.select<{ id: number }>('SELECT id FROM transactions')
    const fx = createTransactionFxRepository(database.client)
    const row = {
      transactionId: String(movement[0]?.id),
      fxRate: '1523.66',
      fxKind: 'MEP' as const,
      fxDate: '2026-07-03',
      sourceSheet: 'resultados_por_realizado',
      sourceRow: 2,
      sourceColumn: 'OperacionCompraDolarMEP',
      operationReference: '7321989',
    }
    await fx.saveIfMissing(String(document[0]?.id), [row])
    await fx.saveIfMissing(String(document[0]?.id), [{ ...row, fxRate: '999.00' }])
    const stored = await fx.getByPeriod(String(period[0]?.id))
    expect(stored).toEqual([
      expect.objectContaining({
        fxRate: '1523.66',
        fxKind: 'MEP',
        sourceSheet: 'resultados_por_realizado',
        sourceColumn: 'OperacionCompraDolarMEP',
        operationReference: '7321989',
      }),
    ])
    database.close()
  })
})

function workbook(options?: { opening?: string; closing?: string; realized?: string[][] }): Uint8Array {
  const book = utils.book_new()
  utils.book_append_sheet(book, utils.aoa_to_sheet(lot(options?.opening ?? '2026-06-30')), 'resultados_por_lotes_iniciales')
  utils.book_append_sheet(book, utils.aoa_to_sheet([
    REALIZED_HEADERS,
    ...(options?.realized ?? [
      trade('YPFD', '7321989', 'Dólares', '1523.66', '1572.71', { Cantidad: '2', 'Precio Compra': '46.99' }),
      trade('PAMP', '7321988', 'US Dollar (Cable)', '1523.66', '1572.71', { Cantidad: '29', 'Precio Compra': '3.285' }),
      income('KO', 'Dividendo', '2026-07-02', '1578.06'),
      income('GD30', 'Cupón', '2026-07-10', '1564.48'),
      income('GD35', 'Cupón', '2026-07-10', '1564.48'),
      realized({
        Ticker: 'ALUA',
        'Tipo Movimiento': 'Orden',
        Fecha: '2026-07-15',
        FechaCompra: '2026-07-15',
        'Moneda Compra': 'Pesos',
        'Operacion Compra': 'Boleto / 100 / COMPRA / 1 / ALUA / $',
        Cantidad: '10',
        'Precio Compra': '800',
      }),
    ]),
  ]), 'resultados_por_realizado')
  utils.book_append_sheet(book, utils.aoa_to_sheet(lot(options?.closing ?? '2026-07-31')), 'resultados_por_lotes_finales')
  return new Uint8Array(write(book, { type: 'buffer', bookType: 'xlsx' }))
}

function lot(date: string): string[][] {
  return [
    LOT_HEADERS,
    ['1', 'Lote', date, date, '0', 'Pesos', 'Boleto / 1 / COMPRA / 1 / ALUA / $', '1', 'ALUA', 'Acciones', '', '', ''],
  ]
}

function trade(
  ticker: string,
  boleto: string,
  currency: string,
  mep: string,
  ccl: string,
  extra: Record<string, string> = {},
): string[] {
  return realized({
    Ticker: ticker,
    Cantidad: '1',
    Fecha: '2026-07-31',
    FechaCompra: '2026-07-03',
    'Moneda Compra': currency,
    'Operacion Compra': `Boleto / ${boleto} / COMPRA / 1 / ${ticker} / usd`,
    'Precio Compra': '1',
    'Tipo Movimiento': 'No Realizado',
    OperacionCompraDolarMEP: mep,
    OperacionCompraDolarCCL: ccl,
    OperacionCompraDolarOficial: '1488',
    ...extra,
  })
}

function income(ticker: string, movement: 'Dividendo' | 'Cupón', date: string, ccl: string): string[] {
  return realized({
    Ticker: ticker,
    Fecha: date,
    'Moneda Venta': 'Dólares C.V. 7000',
    'Operacion Venta': movement === 'Dividendo' ? `Dividendo en efectivo / ${ticker}` : `Renta / ${ticker}`,
    'Tipo Movimiento': movement,
    OperacionVentaDolarCCL: ccl,
  })
}

function realized(values: Record<string, string>): string[] {
  return REALIZED_HEADERS.map((header) => values[header] ?? '')
}
