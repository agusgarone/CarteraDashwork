import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { adaptConsolidatedPosition } from '../import/adapters/consolidatedPositionAdapter'
import { parseBalanzConsolidatedPositionText } from '../parsers/balanz/consolidatedPosition'
import { createDocumentRepository } from '../repositories/documentRepository'
import { createPeriodRepository } from '../repositories/periodRepository'
import { createPortfolioRepository } from '../repositories/portfolioRepository'
import { createSnapshotRepository } from '../repositories/snapshotRepository'
import { createPeriodFxReferenceService } from './periodFxReferenceService'

async function importSnapshot(mep: boolean) {
  const database = openMemoryDatabase()
  const portfolios = createPortfolioRepository(database.client)
  const periods = createPeriodRepository(database.client)
  const snapshots = createSnapshotRepository(database.client)
  const documents = createDocumentRepository(database.client)
  const portfolio = await portfolios.create({ name: 'Cartera', broker: 'BALANZ', baseCurrency: 'ARS' })
  const period = await periods.create({ portfolioId: portfolio.id, year: 2026, month: 1, status: 'COMPLETE' })
  const document = await documents.create({ periodId: period.id, type: 'CONSOLIDATED_POSITION', originalFilename: 'notas.pdf',
    localPath: 'documents/closing.pdf', sha256: 'snapshot-hash', processingStatus: 'PROCESSED', parserVersion: 'test' })
  const parsed = parseBalanzConsolidatedPositionText(`Posición consolidada por concertación
Fecha resumen | 30/01/2026
Total | $ 0
Pesos | $ 0,00
${mep ? 'Dólares | USD 0,00' : ''}
US Dollar (Cable) | USD 0,00
Tipo de cambio para esa fecha: ${mep ? 'MEP $ 1.464,75 | ' : ''}US Dollar $ 1.500,00
`)
  const adapted = adaptConsolidatedPosition(parsed, { portfolioId: portfolio.id, periodId: period.id, createdAt: '' })
  const aggregate = await snapshots.createAggregate({
    snapshot: { portfolioId: portfolio.id, periodId: period.id, date: parsed.snapshotDate, totalValue: parsed.reportedTotal, currency: 'ARS', sourceDocumentId: document.id },
    positions: [], cashBalances: adapted.cashBalances,
  })
  return { database, period, aggregate, service: createPeriodFxReferenceService({ periods, portfolios, snapshots, documents }) }
}

describe('cotización explícita del parser persistida en SQLite', () => {
  it('conserva un FX válido con saldo USD cero y fecha real anterior al cierre calendario', async () => {
    const w = await importSnapshot(true)
    try {
      expect(await w.database.client.select('SELECT amount, fx_rate FROM cash_balances WHERE currency = $1', ['USD_MEP']))
        .toEqual([{ amount: '0.00', fx_rate: '1464.75' }])
      expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({
        status: 'AVAILABLE', currency: 'USD_MEP', rate: '1464.75', date: '2026-01-30', snapshotId: w.aggregate.snapshot.id,
        source: { kind: 'EXPLICIT_SNAPSHOT_RATE', originalFilename: 'notas.pdf' },
      })
    } finally { w.database.close() }
  })
  it('informa missing USD MEP aun cuando existe cotización CCL', async () => {
    const w = await importSnapshot(false)
    try {
      expect(await w.service.getPeriodUsdMepReference(w.period.id)).toMatchObject({ status: 'UNAVAILABLE', reason: 'MISSING_USD_MEP_BALANCE' })
    } finally { w.database.close() }
  })
})