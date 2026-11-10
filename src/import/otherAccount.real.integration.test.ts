import type { ImportPeriodResultView } from '../application/importPeriodApplication'
import { PendingExternalFlowFxError } from '../engine/calculations/externalFlowValuation'
import { loadPortfolioOverview } from '../application/portfolioOverview'
import { createPerformanceAnalysisService } from '../engine/services/performanceAnalysisService'
import { createInstrumentRepository } from '../repositories/instrumentRepository'
import { createCorporateActionRepository } from '../repositories/corporateActionRepository'
import { createCashMovementLegRepository } from '../repositories/cashMovementLegRepository'
import { createTransactionFxRepository } from '../repositories/transactionFxRepository'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { importSelectedDocuments } from '../application/importPeriodApplication'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { createNodeImportFiles } from './nodeImportFiles'
import { createPeriodAnalysisService } from '../engine/services/periodAnalysisService'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'

const root = path.resolve('src/parsers/balanz/fixtures/private/other-account')
const months = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
]
async function pathsFor(month: string, excel: boolean) {
  const folder = path.join(root, month + '2026')
  return (await readdir(folder))
    .filter(
      (name) => name.endsWith('.pdf') || (excel && name.endsWith('.xlsx')),
    )
    .map((name) => path.join(folder, name))
}
async function counts(db: ReturnType<typeof openMemoryDatabase>['client']) {
  return db.select(
    'SELECT (SELECT COUNT(*) FROM instruments) AS instruments, (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM snapshots) AS snapshots, (SELECT COUNT(*) FROM documents) AS documents',
  )
}

async function verifyAugust(
  db: ReturnType<typeof openMemoryDatabase>['client'],
  result: ImportPeriodResultView,
  expectedTicker = 'PER2 A',
) {
  const funds = await db.select<{
    id: number
    ticker: string
    name: string
    category: string
    currency: string
  }>(
    "SELECT * FROM instruments WHERE ticker IN ('PER2 A', 'LECAPSA') OR name LIKE '%LECAPS%' OR name LIKE '%PERFORMANCE II%'",
  )
  expect(funds).toHaveLength(1)
  const fund = funds[0]!
  expect(fund).toMatchObject({
    ticker: expectedTicker,
    name: 'BALANZ LECAPS - Clase A',
    category: 'FUND',
    currency: 'ARS',
  })
  expect(
    await db.select('SELECT * FROM positions WHERE instrument_id = $1', [
      fund.id,
    ]),
  ).toEqual([])
  expect(
    await db.select(
      'SELECT * FROM corporate_actions WHERE instrument_id = $1',
      [fund.id],
    ),
  ).toEqual([])
  const rows = await db.select<{
    date: string
    type: string
    quantity: string
    currency: string
    unit_price: string
    net_amount: string
    source_reference: string
    source_type: string
  }>(
    'SELECT t.*, d.type AS source_type FROM transactions t JOIN documents d ON d.id = t.source_document_id WHERE t.instrument_id = $1 ORDER BY t.date',
    [fund.id],
  )
  expect(rows).toHaveLength(2)
  const foreignFund = await db.select(
    "SELECT t.currency, t.quantity, t.source_reference FROM transactions t JOIN instruments i ON i.id = t.instrument_id WHERE i.ticker = 'BCRDolarA' AND t.type = 'FUND_REDEMPTION' AND t.date = '2026-08-18'",
  )
  expect(foreignFund).toEqual([
    expect.objectContaining({ currency: 'USD_MEP', quantity: '-272.334307' }),
  ])
  expect(rows[0]).toMatchObject({
    date: '2026-08-07',
    type: 'FUND_SUBSCRIPTION',
    quantity: '873244.625564',
    currency: 'ARS',
    unit_price: '2.077195',
    net_amount: '1813899.37',
  })
  expect(rows[1]).toMatchObject({
    date: '2026-08-18',
    type: 'FUND_REDEMPTION',
    quantity: '-873244.625564',
    currency: 'ARS',
    unit_price: '2.086374',
    net_amount: '1821914.88',
  })
  expect(rows[0]!.source_type).toBe('MONTHLY_ACCOUNT')
  expect(rows[1]!.source_type).toBe('MONTHLY_FUND_STATEMENT')
  expect(rows[0]!.source_reference).toContain('BALANZ PERFORMANCE II clase A')
  expect(rows[1]!.source_reference).toContain('BALANZ LECAPS')
  expect(
    result.fundIdentityAliases?.map((alias) => alias.rawName).sort(),
  ).toEqual(['BALANZ LECAPS', 'BALANZ PERFORMANCE II clase A'])
  expect(
    result.fundIdentityAliases?.every(
      (alias) =>
        alias.canonicalIdentity === 'CNV:81959|A|ARS' &&
        alias.reason === 'KNOWN_FUND_DENOMINATION_ALIAS',
    ),
  ).toBe(true)
  expect(result.cashLedgerReconciled).toBe(true)
  const periods = createPeriodRepository(db)
  const snapshots = createSnapshotRepository(db)
  const transactions = createTransactionRepository(db)
  const fxEnrichments = createTransactionFxRepository(db)
  const analysis = await createPerformanceAnalysisService({
    periods,
    snapshots,
    transactions,
    fxEnrichments,
    instruments: createInstrumentRepository(db),
    corporateActions: createCorporateActionRepository(db),
    cashLegs: createCashMovementLegRepository(db),
    analysis: createPeriodAnalysisService({
      periods,
      snapshots,
      transactions,
      fxEnrichments,
    }),
  }).analyzePeriod(result.period.id)
  const flow = analysis.performance.positionFlows.find(
    (row) => row.instrumentId === String(fund.id),
  )
  expect(flow?.quantity).toMatchObject({
    openingQuantity: '0',
    subscribedQuantity: '873244.625564',
    redeemedQuantity: '873244.625564',
    expectedClosingQuantity: '0',
    actualClosingQuantity: '0',
    difference: '0',
    status: 'RECONCILED',
  })
  console.log(
    'AUGUST_AUDIT',
    JSON.stringify({
      funds: funds.map((row) => ({
        id: row.id,
        ticker: row.ticker,
        name: row.name,
      })),
      flow,
      base: analysis.base,
      periodReturn: analysis.periodReturn,
      attribution: analysis.performance.attributionStatus,
      counts: await counts(db),
    }),
  )
}

describe('segunda cartera real con FCI intrames', () => {
  for (const excel of [false, true])
    it(`recorrido y reimportación, Excel ${excel}`, async (context) => {
      if (!existsSync(root))
        return context.skip('Faltan documentos privados de la segunda cartera')
      const database = openMemoryDatabase()
      const appDataDir = await mkdtemp(
        path.join(tmpdir(), 'other-account-regression-'),
      )
      const base = {
        db: database.client,
        appDataDir,
        files: createNodeImportFiles(),
      }
      try {
        for (const month of months) {
          const paths = await pathsFor(month, excel)
          const beforeMonth = await counts(database.client)
          const result = await importSelectedDocuments({ ...base, paths })
          expect(result.outcome).toBe('created')
          if (month === 'marzo') {
            expect(result.externalFlowValuation?.status).toBe(
              'PENDING_EXTERNAL_FLOW_FX',
            )
            expect(result.cashLedgerReconciled).toBe(true)
            expect(result.periodReturnLabel).toBeNull()
          }
          console.log(
            'SECOND_ACCOUNT',
            excel,
            month,
            JSON.stringify({
              analysis: result.analysis,
              cashLedgerReconciled: result.cashLedgerReconciled,
            }),
          )
          if (month === 'agosto') {
            console.log(
              'AUGUST_INSTRUMENT_COUNTS',
              JSON.stringify({
                before: beforeMonth,
                after: await counts(database.client),
              }),
            )
            await verifyAugust(database.client, result)
            const before = await counts(database.client)
            const repeated = await importSelectedDocuments({ ...base, paths })
            expect(repeated.outcome).toBe('existing')
            expect(repeated.fundIdentityAliases).toEqual(
              result.fundIdentityAliases,
            )
            expect(await counts(database.client)).toEqual(before)
          }
          if (month !== 'mayo') continue
          const instruments = await database.client.select<{
            id: number
            ticker: string
            category: string
            currency: string
            broker_identifier: string
            name: string
          }>("SELECT * FROM instruments WHERE ticker = 'BAHUSD A'")
          expect(instruments).toHaveLength(1)
          const fund = instruments[0]!
          expect(fund).toMatchObject({
            category: 'FUND',
            currency: 'USD_MEP',
            broker_identifier: 'BAHUSD A',
            name: 'BALANZ AHORRO EN DOLARES FCI (Corporativo) - Clase A',
          })
          expect(
            await database.client.select(
              'SELECT id FROM positions WHERE instrument_id = $1',
              [fund.id],
            ),
          ).toEqual([])
          const movements = await database.client.select<{
            type: string
            quantity: string
            currency: string
            net_amount: string
          }>(
            'SELECT type, quantity, currency, net_amount FROM transactions WHERE instrument_id = $1 ORDER BY date',
            [fund.id],
          )
          expect(movements).toEqual([
            {
              type: 'FUND_SUBSCRIPTION',
              quantity: '658.483036',
              currency: 'USD_MEP',
              net_amount: '928.87',
            },
            {
              type: 'FUND_REDEMPTION',
              quantity: '-658.483036',
              currency: 'USD_MEP',
              net_amount: '928.68',
            },
          ])
          expect(
            movements
              .reduce((sum, row) => sum.plus(row.quantity), new Decimal(0))
              .isZero(),
          ).toBe(true)
          const db = database.client
          const periods = createPeriodRepository(db)
          const snapshots = createSnapshotRepository(db)
          const transactions = createTransactionRepository(db)
          const analysis = await createPerformanceAnalysisService({
            periods,
            snapshots,
            transactions,
            analysis: createPeriodAnalysisService({
              periods,
              snapshots,
              transactions,
            }),
            instruments: createInstrumentRepository(db),
            corporateActions: createCorporateActionRepository(db),
            cashLegs: createCashMovementLegRepository(db),
            fxEnrichments: createTransactionFxRepository(db),
          }).analyzePeriod(result.period.id)
          const flow = analysis.performance.positionFlows.find(
            (row) => row.instrumentId === String(fund.id),
          )
          expect(flow?.quantity.status).toBe('RECONCILED')
          expect(flow?.quantity.difference).toMatch(/^0(?:\.0+)?$/)
          console.log('MAY_FUND_ENGINE', excel, JSON.stringify(flow))
          const before = await counts(database.client)
          expect(
            (await importSelectedDocuments({ ...base, paths })).outcome,
          ).toBe('existing')
          expect(await counts(database.client)).toEqual(before)
        }
      } finally {
        database.close()
      }
    }, 120000)

  it('agosto resuelve el alias documentado de LECAPS y PERFORMANCE II en una base limpia', async (context) => {
    if (!existsSync(root))
      return context.skip('Faltan documentos privados de la segunda cartera')
    const database = openMemoryDatabase()
    try {
      const opening = (await pathsFor('julio', false)).find((file) =>
        path.basename(file).startsWith('ResumenDeCuenta_'),
      )!
      const base = {
        db: database.client,
        files: createNodeImportFiles(),
        appDataDir: await mkdtemp(path.join(tmpdir(), 'august-order-')),
      }
      const paths = [opening, ...(await pathsFor('agosto', false))]
      const result = await importSelectedDocuments({ ...base, paths })
      await verifyAugust(database.client, result)
      const before = await counts(database.client)
      expect((await importSelectedDocuments({ ...base, paths })).outcome).toBe(
        'existing',
      )
      expect(await counts(database.client)).toEqual(before)
      const juneOpening = (await pathsFor('junio', false)).find((file) =>
        path.basename(file).startsWith('ResumenDeCuenta_'),
      )!
      await importSelectedDocuments({
        ...base,
        paths: [juneOpening, ...(await pathsFor('julio', false))],
      })
      await importSelectedDocuments({
        ...base,
        paths: await pathsFor('septiembre', false),
      })
      await verifyAugust(database.client, result)
    } finally {
      database.close()
    }
  }, 120000)

  it('reutiliza una identidad previamente persistida con el código LECAPSA', async (context) => {
    if (!existsSync(root))
      return context.skip('Faltan documentos privados de la segunda cartera')
    const database = openMemoryDatabase()
    try {
      const known = await createInstrumentRepository(database.client).create({
        ticker: 'LECAPSA',
        name: 'BALANZ LECAPS - Clase A',
        category: 'FUND',
        currency: 'ARS',
        brokerIdentifier: 'LECAPSA',
      })
      const opening = (await pathsFor('julio', false)).find((file) =>
        path.basename(file).startsWith('ResumenDeCuenta_'),
      )!
      const options = {
        db: database.client,
        files: createNodeImportFiles(),
        appDataDir: await mkdtemp(path.join(tmpdir(), 'august-existing-fund-')),
        paths: [opening, ...(await pathsFor('agosto', false))],
      }
      const result = await importSelectedDocuments(options)
      await verifyAugust(database.client, result, 'LECAPSA')
      expect(
        (await createInstrumentRepository(database.client).getById(known.id))
          ?.ticker,
      ).toBe('LECAPSA')
      const before = await counts(database.client)
      expect((await importSelectedDocuments(options)).outcome).toBe('existing')
      expect(await counts(database.client)).toEqual(before)
    } finally {
      database.close()
    }
  }, 120000)

  it('importa septiembre desde los documentos de apertura y cierre', async (context) => {
    if (!existsSync(root))
      return context.skip('Faltan documentos privados de la segunda cartera')
    const database = openMemoryDatabase()
    try {
      const opening = (await pathsFor('agosto', false)).find((file) =>
        path.basename(file).startsWith('ResumenDeCuenta_'),
      )!
      const result = await importSelectedDocuments({
        db: database.client,
        files: createNodeImportFiles(),
        appDataDir: await mkdtemp(
          path.join(tmpdir(), 'other-account-september-'),
        ),
        paths: [opening, ...(await pathsFor('septiembre', false))],
      })
      expect(result.outcome).toBe('created')
      console.log(
        'SECOND_ACCOUNT_SEPTEMBER',
        JSON.stringify({
          analysis: result.analysis,
          cashLedgerReconciled: result.cashLedgerReconciled,
        }),
      )
    } finally {
      database.close()
    }
  }, 120000)

  it('marzo queda pendiente de FX documental con caja nominal reconciliada', async (context) => {
    if (!existsSync(root))
      return context.skip('Faltan documentos privados de la segunda cartera')
    const database = openMemoryDatabase()
    const appDataDir = await mkdtemp(
      path.join(tmpdir(), 'other-account-march-'),
    )
    try {
      let periodId = ''
      for (const month of months.slice(0, 3)) {
        const result = await importSelectedDocuments({
          db: database.client,
          appDataDir,
          files: createNodeImportFiles(),
          paths: await pathsFor(month, false),
        })
        periodId = result.period.id
        if (month === 'marzo') {
          expect(result.analysis).toBeNull()
          expect(result.cashLedgerReconciled).toBe(true)
          expect(result.externalFlowValuation).toMatchObject({
            status: 'PENDING_EXTERNAL_FLOW_FX',
            flows: [
              {
                amount: '998.71',
                currency: 'USD_MEP',
                date: '2026-03-26',
                type: 'WITHDRAWAL',
              },
            ],
          })
          const view = await loadPortfolioOverview({
            db: database.client,
            periodId,
          })
          expect(view).toMatchObject({
            externalFlowValuation: { status: 'PENDING_EXTERNAL_FLOW_FX' },
            metrics: {
              openingPortfolioValue: '24522739.00',
              currentPortfolioValue: '23198792',
              investmentResult: null,
              withdrawals: null,
              performanceAttribution: 'PENDING',
            },
            periodReturn: null,
          })
          expect(result.periodReturnLabel).toBeNull()
          console.log(
            'MARCH_PENDING_VIEW',
            JSON.stringify({
              metrics: view?.metrics,
              periodReturn: view?.periodReturn,
              externalFlowValuation: view?.externalFlowValuation,
            }),
          )
        }
      }
      const externalFlows = await database.client.select(
        "SELECT t.type, t.currency, t.quantity, t.net_amount, t.source_reference, i.ticker FROM transactions t LEFT JOIN instruments i ON i.id = t.instrument_id WHERE t.period_id = $1 AND t.type IN ('CONTRIBUTION','WITHDRAWAL')",
        [periodId],
      )
      expect(externalFlows).toEqual([
        expect.objectContaining({
          type: 'WITHDRAWAL',
          currency: 'USD_MEP',
          ticker: null,
          source_reference: 'Comprobante de Pago / 757231',
          net_amount: '998.71',
        }),
      ])
      console.log('MARCH_EXTERNAL_FLOWS', externalFlows)
      await expect(
        createPeriodAnalysisService({
          periods: createPeriodRepository(database.client),
          snapshots: createSnapshotRepository(database.client),
          transactions: createTransactionRepository(database.client),
        }).analyzePeriod(periodId),
      ).rejects.toBeInstanceOf(PendingExternalFlowFxError)
    } finally {
      database.close()
    }
  }, 120000)
})
