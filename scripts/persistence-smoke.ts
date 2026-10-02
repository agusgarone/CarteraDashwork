import type { DatabaseClient } from '../src/database/client.ts'
import { openMemoryDatabase } from '../src/database/sqliteMemory.ts'
import { RepositoryError } from '../src/database/errors.ts'
import { mapInstrumentRow } from '../src/database/mappers/instrumentMapper.ts'
import { mapSnapshotRow } from '../src/database/mappers/snapshotMapper.ts'
import { mapTransactionRow } from '../src/database/mappers/transactionMapper.ts'
import { createCorporateActionRepository } from '../src/repositories/corporateActionRepository.ts'
import { createDocumentRepository } from '../src/repositories/documentRepository.ts'
import { createInstrumentRepository } from '../src/repositories/instrumentRepository.ts'
import { createPeriodRepository } from '../src/repositories/periodRepository.ts'
import { createPortfolioRepository } from '../src/repositories/portfolioRepository.ts'
import { createSnapshotRepository } from '../src/repositories/snapshotRepository.ts'
import { createTransactionRepository } from '../src/repositories/transactionRepository.ts'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertDecimal(value: string, expected: string, label: string): void {
  assert(value === expected, `${label}: se esperaba ${expected} y llegó ${value}`)
  assert(typeof value === 'string', `${label} no quedó como string`)
}

function checkMappers(): void {
  const transaction = mapTransactionRow({
    id: 42,
    portfolio_id: 1,
    period_id: 2,
    instrument_id: null,
    date: '2026-08-03',
    type: 'CONTRIBUTION',
    quantity: null,
    unit_price: null,
    gross_amount: '1250000.00',
    net_amount: '1250000.00',
    fees: null,
    taxes: null,
    currency: 'ARS',
    fx_rate: null,
    source_document_id: null,
    source_reference: null,
    created_at: '2026-08-03 12:00:00',
  })
  assert(transaction.id === '42', 'el id de la transacción no pasó a string')
  assert(transaction.instrumentId === null, 'instrumentId nulo no se conservó')
  assertDecimal(transaction.grossAmount ?? '', '1250000.00', 'grossAmount')
  assert(transaction.type === 'CONTRIBUTION', 'el tipo de movimiento no se mapeó')

  let rejected = false
  try {
    mapTransactionRow({
      id: 1,
      portfolio_id: 1,
      period_id: 1,
      instrument_id: null,
      date: '2026-08-03',
      type: 'CORPORATE_ACTION',
      quantity: null,
      unit_price: null,
      gross_amount: null,
      net_amount: null,
      fees: null,
      taxes: null,
      currency: 'ARS',
      fx_rate: null,
      source_document_id: null,
      source_reference: null,
      created_at: '2026-08-03 12:00:00',
    })
  } catch (error) {
    rejected = error instanceof RepositoryError
  }
  assert(rejected, 'CORPORATE_ACTION no debe aceptarse como Transaction')

  const snapshot = mapSnapshotRow({
    id: 7,
    portfolio_id: 1,
    period_id: 2,
    date: '2026-08-31',
    total_value: '26383988.00',
    currency: 'ARS',
    source_document_id: null,
    created_at: '2026-08-31 20:31:00',
  })
  assert(snapshot.id === '7', 'el id del snapshot no pasó a string')
  assertDecimal(snapshot.totalValue, '26383988.00', 'totalValue')

  const instrument = mapInstrumentRow({
    id: 3,
    ticker: 'GGAL',
    name: null,
    category: 'STOCK',
    currency: 'ARS',
    broker_identifier: null,
    created_at: '2026-08-01 00:00:00',
  })
  assert(instrument.id === '3', 'el id del instrumento no pasó a string')
  assert(!Object.hasOwn(instrument, 'quantity'), 'Instrument no debe tener quantity')
  assert(!Object.hasOwn(instrument, 'currentValue'), 'Instrument no debe tener currentValue')
  assert(!Object.hasOwn(instrument, 'returnPercentage'), 'Instrument no debe tener returnPercentage')
}

async function checkRoundtrip(db: DatabaseClient): Promise<void> {
  const portfolios = createPortfolioRepository(db)
  const periods = createPeriodRepository(db)
  const snapshots = createSnapshotRepository(db)
  const transactions = createTransactionRepository(db)
  const documents = createDocumentRepository(db)
  const corporateActions = createCorporateActionRepository(db)

  const portfolio = await portfolios.create({
    name: 'Mi cartera',
    broker: 'BALANZ',
    baseCurrency: 'ARS',
  })
  const loadedPortfolio = await portfolios.getById(portfolio.id)
  assert(loadedPortfolio?.name === 'Mi cartera', 'no se recuperó el portfolio')
  assert(loadedPortfolio?.broker === 'BALANZ', 'no se recuperó el broker')
  assert(loadedPortfolio?.baseCurrency === 'ARS', 'no se recuperó la moneda base')
  assert(typeof portfolio.id === 'string', 'el id de portfolio no es string')

  const missing = await portfolios.getById('999999')
  assert(missing === null, 'getById de un portfolio inexistente debería ser null')

  const period = await periods.create({
    portfolioId: portfolio.id,
    year: 2026,
    month: 8,
  })
  const loadedPeriod = await periods.getByYearMonth(portfolio.id, 2026, 8)
  assert(loadedPeriod?.id === period.id, 'no se recuperó el período de agosto 2026')
  assert(loadedPeriod?.status === 'PENDING', 'el período no quedó PENDING')

  let duplicateRejected = false
  try {
    await periods.create({ portfolioId: portfolio.id, year: 2026, month: 8 })
  } catch (error) {
    duplicateRejected = error instanceof RepositoryError
  }
  assert(duplicateRejected, 'el período duplicado debería fallar por la clave única')

  const snapshot = await snapshots.createSnapshot({
    portfolioId: portfolio.id,
    periodId: period.id,
    date: '2026-08-31',
    totalValue: '26383988.00',
    currency: 'ARS',
    sourceDocumentId: null,
  })
  const byPeriod = await snapshots.getByPeriod(period.id)
  assert(byPeriod.length === 1, 'getByPeriod no devolvió el snapshot')
  assertDecimal(byPeriod[0]?.totalValue ?? '', '26383988.00', 'snapshot.totalValue')
  assert(byPeriod[0]?.date === '2026-08-31', 'la fecha del snapshot no coincide')
  assert(snapshot.id === byPeriod[0]?.id, 'el snapshot creado no coincide con el leído')

  const latest = await snapshots.getLatest(portfolio.id)
  assert(latest?.id === snapshot.id, 'getLatest no devolvió el snapshot')
  const byDate = await snapshots.getByDate(portfolio.id, '2026-08-31')
  assert(byDate?.id === snapshot.id, 'getByDate no devolvió el snapshot')

  const completed = await periods.updateStatus(period.id, {
    status: 'COMPLETE',
    completedAt: '2026-08-31T20:31:00Z',
  })
  assert(completed.status === 'COMPLETE', 'updateStatus no guardó COMPLETE')
  assert(completed.completedAt === '2026-08-31T20:31:00Z', 'completedAt no se guardó')

  const contribution = await transactions.create({
    portfolioId: portfolio.id,
    periodId: period.id,
    instrumentId: null,
    date: '2026-08-03',
    type: 'CONTRIBUTION',
    quantity: null,
    unitPrice: null,
    grossAmount: '1250000.00',
    netAmount: '1250000.00',
    fees: null,
    taxes: null,
    currency: 'ARS',
    fxRate: null,
    sourceDocumentId: null,
    sourceReference: null,
  })
  const sameDayWithdrawal = await transactions.create({
    portfolioId: portfolio.id,
    periodId: period.id,
    instrumentId: null,
    date: '2026-08-03',
    type: 'WITHDRAWAL',
    quantity: null,
    unitPrice: null,
    grossAmount: '100.00',
    netAmount: '100.00',
    fees: null,
    taxes: null,
    currency: 'ARS',
    fxRate: null,
    sourceDocumentId: null,
    sourceReference: null,
  })
  const loadedTransactions = await transactions.getByPeriod(period.id)
  assert(loadedTransactions.length === 2, 'no se recuperaron los dos movimientos')
  assert(loadedTransactions[0]?.id === contribution.id, 'el orden por fecha e id no es estable')
  assert(loadedTransactions[1]?.id === sameDayWithdrawal.id, 'el segundo movimiento no quedó al final')
  assert(loadedTransactions[0]?.type === 'CONTRIBUTION', 'el aporte no se recuperó')
  assertDecimal(loadedTransactions[0]?.grossAmount ?? '', '1250000.00', 'aporte.grossAmount')

  let absolutePathRejected = false
  try {
    await documents.create({
      periodId: period.id,
      type: 'OTHER',
      originalFilename: 'resumen.pdf',
      localPath: 'C:\\Users\\hp\\resumen.pdf',
      sha256: 'abc',
    })
  } catch (error) {
    absolutePathRejected = error instanceof RepositoryError
  }
  assert(absolutePathRejected, 'una ruta absoluta no debería persistirse')

  const document = await documents.create({
    periodId: period.id,
    type: 'MONTHLY_ACCOUNT',
    originalFilename: 'resumen-comitente.pdf',
    localPath: 'documents/2026/08/resumen-comitente.pdf',
    sha256: 'hash-de-prueba',
  })
  assert(
    document.localPath === 'documents/2026/08/resumen-comitente.pdf',
    'localPath relativo no se conservó',
  )
  const processed = await documents.updateProcessingStatus(document.id, 'PROCESSED')
  assert(processed.processingStatus === 'PROCESSED', 'updateProcessingStatus no guardó PROCESSED')

  const instruments = createInstrumentRepository(db)
  const instrument = await instruments.create({
    ticker: 'GGAL',
    name: null,
    category: 'STOCK',
    currency: 'ARS',
    brokerIdentifier: null,
  })
  assert(!Object.hasOwn(instrument, 'quantity'), 'el instrumento persistido trajo quantity')

  const action = await corporateActions.create({
    portfolioId: portfolio.id,
    periodId: period.id,
    instrumentId: instrument.id,
    date: '2026-08-15',
    type: 'SPLIT',
    quantityBefore: '10',
    quantityChange: '10',
    quantityAfter: '20',
    ratio: '2',
    description: null,
    sourceDocumentId: null,
  })
  const actions = await corporateActions.getByPeriod(period.id)
  assert(actions.length === 1 && actions[0]?.id === action.id, 'no se recuperó la corporate action')
  assert(
    loadedTransactions.every((item) => item.type !== 'SPLIT'),
    'un split no debe aparecer como Transaction',
  )
  const transactionsAfterAction = await transactions.getByPeriod(period.id)
  assert(transactionsAfterAction.length === 2, 'la corporate action se mezcló con los movimientos')
}

async function countRows(db: DatabaseClient, table: string): Promise<number> {
  const rows = await db.select<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
  const count = rows[0]?.count ?? 0
  return typeof count === 'number' ? count : Number(count)
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? error.cause.message : ''
  return `${error.message} ${cause}`
}

async function checkIntegrity(db: DatabaseClient): Promise<void> {
  const portfolios = createPortfolioRepository(db)
  const periods = createPeriodRepository(db)
  const instruments = createInstrumentRepository(db)
  const snapshots = createSnapshotRepository(db)

  const portfolio = await portfolios.create({
    name: 'Mi cartera',
    broker: 'BALANZ',
    baseCurrency: 'ARS',
  })
  const period = await periods.create({ portfolioId: portfolio.id, year: 2026, month: 8 })
  const ggal = await instruments.create({
    ticker: 'GGAL',
    name: null,
    category: 'STOCK',
    currency: 'ARS',
    brokerIdentifier: null,
  })
  const spy = await instruments.create({
    ticker: 'SPY',
    name: null,
    category: 'CEDEAR',
    currency: 'ARS',
    brokerIdentifier: null,
  })

  const snapshot = await snapshots.createSnapshot({
    portfolioId: portfolio.id,
    periodId: period.id,
    date: '2026-08-31',
    totalValue: '26383988.00',
    currency: 'ARS',
    sourceDocumentId: null,
  })
  await snapshots.createPosition({
    snapshotId: snapshot.id,
    instrumentId: ggal.id,
    quantity: '10',
    unitPrice: '1.00',
    marketValue: '10.00',
    currency: 'ARS',
  })
  await snapshots.createPosition({
    snapshotId: snapshot.id,
    instrumentId: spy.id,
    quantity: '2',
    unitPrice: '1.00',
    marketValue: '2.00',
    currency: 'ARS',
  })
  await snapshots.createCashBalance({
    snapshotId: snapshot.id,
    currency: 'ARS',
    amount: '10.00',
    fxRate: null,
    valueInBaseCurrency: null,
  })
  assert((await snapshots.getPositions(snapshot.id)).length === 2, 'faltan posiciones del snapshot')

  await db.execute('DELETE FROM snapshots WHERE id = $1', [snapshot.id])
  assert(
    (await snapshots.getPositions(snapshot.id)).length === 0,
    'ON DELETE CASCADE no eliminó las posiciones',
  )
  assert(
    (await snapshots.getCashBalances(snapshot.id)).length === 0,
    'ON DELETE CASCADE no eliminó la caja',
  )

  const held = await snapshots.createSnapshot({
    portfolioId: portfolio.id,
    periodId: period.id,
    date: '2026-08-30',
    totalValue: '1.00',
    currency: 'ARS',
    sourceDocumentId: null,
  })
  let foreignKeyRejected = false
  try {
    await snapshots.createPosition({
      snapshotId: held.id,
      instrumentId: '999999',
      quantity: '1',
      unitPrice: '1.00',
      marketValue: '1.00',
      currency: 'ARS',
    })
  } catch (error) {
    foreignKeyRejected = error instanceof RepositoryError
    assert(
      errorText(error).includes('FOREIGN KEY constraint failed'),
      `la FK inexistente no falló con el constraint: ${errorText(error)}`,
    )
  }
  assert(foreignKeyRejected, 'insertar una posición con instrument_id inexistente debería fallar')
  assert((await snapshots.getPositions(held.id)).length === 0, 'la posición inválida quedó guardada')

  const snapshotsBefore = await countRows(db, 'snapshots')
  let rolledBack = false
  try {
    await snapshots.createAggregate({
      snapshot: {
        portfolioId: portfolio.id,
        periodId: period.id,
        date: '2026-08-29',
        totalValue: '10.00',
        currency: 'ARS',
        sourceDocumentId: null,
      },
      positions: [
        {
          instrumentId: ggal.id,
          quantity: '1',
          unitPrice: '1.00',
          marketValue: '1.00',
          currency: 'ARS',
        },
        {
          instrumentId: '999999',
          quantity: '1',
          unitPrice: '1.00',
          marketValue: '1.00',
          currency: 'ARS',
        },
      ],
      cashBalances: [
        {
          currency: 'ARS',
          amount: '5.00',
          fxRate: null,
          valueInBaseCurrency: null,
        },
      ],
    })
  } catch (error) {
    rolledBack = error instanceof RepositoryError
    assert(
      errorText(error).includes('FOREIGN KEY constraint failed'),
      `el rollback no mostró el constraint: ${errorText(error)}`,
    )
  }
  assert(rolledBack, 'createAggregate debería fallar si la segunda posición es inválida')
  assert(
    (await countRows(db, 'snapshots')) === snapshotsBefore,
    'el snapshot del aggregate fallido quedó persistido',
  )
  const orphanSnapshot = await db.select<{ id: number }>(
    `SELECT id FROM snapshots WHERE date = '2026-08-29'`,
  )
  assert(orphanSnapshot.length === 0, 'quedó un snapshot del 2026-08-29')
  assert((await countRows(db, 'positions')) === 0, 'quedaron posiciones después del rollback')
  assert((await countRows(db, 'cash_balances')) === 0, 'quedó caja después del rollback')
}

async function main(): Promise<void> {
  checkMappers()
  const memory = openMemoryDatabase()
  try {
    await checkRoundtrip(memory.client)
  } finally {
    memory.close()
  }

  const integrity = openMemoryDatabase()
  try {
    await checkIntegrity(integrity.client)
  } finally {
    integrity.close()
  }
  console.log('persistence smoke ok')
}

await main()
