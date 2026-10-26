import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importSelectedDocuments } from '../application/importPeriodApplication'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { createNodeImportFiles } from './nodeImportFiles'

const directory = fileURLToPath(new URL('../parsers/balanz/fixtures/private/Enero/', import.meta.url))

describe('enero real con cierre en viernes y fin de mes en sábado', () => {
  it('importa y reimporta los cuatro PDF conservando sus fechas internas', async (context) => {
    if (!existsSync(directory)) return context.skip('Faltan los PDF privados de Enero')
    const paths = (await readdir(directory)).filter(name => name.endsWith('.pdf')).map(name => path.join(directory, name))
    expect(paths).toHaveLength(4)
    const root = await mkdtemp(path.join(tmpdir(), 'january-import-'))
    const database = openMemoryDatabase()
    try {
      // Deliberately remove all dates and document hints from the filenames.
      const renamedPaths: string[] = []
      for (const [index, source] of paths.entries()) {
        const destination = path.join(root, `document-${index}.pdf`)
        await copyFile(source, destination)
        renamedPaths.push(destination)
      }
      const options = { db: database.client, appDataDir: root, files: createNodeImportFiles(), paths: renamedPaths }
      const first = await importSelectedDocuments(options)
      expect(first.outcome).toBe('created')
      expect(first.period).toMatchObject({ year: 2026, month: 1, status: 'COMPLETE' })
      const snapshots = await database.client.select('SELECT date, total_value FROM snapshots ORDER BY date')
      expect(snapshots).toEqual([
        { date: '2025-12-30', total_value: '16217347' },
        { date: '2026-01-30', total_value: '16382340' },
      ])
      const al30 = await database.client.select<{ type: string; quantity: string }>(
        `SELECT transactions.type, transactions.quantity FROM transactions
         JOIN instruments ON instruments.id = transactions.instrument_id
         WHERE instruments.ticker = 'AL30' ORDER BY transactions.date`,
      )
      expect(al30).toEqual([
        { type: 'BUY', quantity: '367' },
        { type: 'SELL', quantity: '-367' },
      ])
      expect(await database.client.select(
        `SELECT positions.id FROM positions JOIN instruments ON instruments.id = positions.instrument_id WHERE instruments.ticker = 'AL30'`,
      )).toEqual([])
      const before = await database.client.select('SELECT COUNT(*) AS count FROM transactions')
      expect((await importSelectedDocuments(options)).outcome).toBe('existing')
      expect(await database.client.select('SELECT COUNT(*) AS count FROM transactions')).toEqual(before)
      expect(await database.client.select('SELECT date, total_value FROM snapshots ORDER BY date')).toEqual(snapshots)
    } finally { database.close() }
  }, 120_000)
})