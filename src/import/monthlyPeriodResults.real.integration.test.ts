import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importSelectedDocuments } from '../application/importPeriodApplication'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { parseBalanzPeriodResults } from '../parsers/balanz/periodResults'
import { createNodeImportFiles } from './nodeImportFiles'

const root = fileURLToPath(new URL('../parsers/balanz/fixtures/private/', import.meta.url))
const cases = [
  { folder: 'Enero', month: 1, excelFolder: 'Enero', extra: null },
  { folder: 'Junio', month: 6, excelFolder: 'Junio', extra: 'Julio/ResumenDeCuenta_20260630.pdf' },
  { folder: 'Julio', month: 7, excelFolder: 'Agosto', extra: null },
  { folder: 'Agosto', month: 8, excelFolder: 'Julio', extra: 'Julio/ResumenDeCuenta_20260731.pdf' },
]

describe('Excel real como enrichment de meses ya importados', () => {
  for (const fixture of cases) it(fixture.folder, async (context) => {
    const directory = path.join(root, fixture.folder)
    if (!existsSync(directory)) return context.skip('Faltan los documentos privados')
    const paths = (await readdir(directory)).filter(name => name.endsWith('.pdf')).map(name => path.join(directory, name))
    if (fixture.extra) paths.push(path.join(root, fixture.extra))
    const excelDir = path.join(root, fixture.excelFolder)
    const name = (await readdir(excelDir)).find(name => name.endsWith('.xlsx'))
    if (!name) return context.skip('Falta el Excel privado')
    const excelPath = path.join(excelDir, name)
    const parsed = parseBalanzPeriodResults(new Uint8Array(await readFile(excelPath)))
    expect(parsed.closingDate).toBe(`2026-${String(fixture.month).padStart(2, '0')}-${fixture.month === 1 || fixture.month === 7 || fixture.month === 8 ? '31' : '30'}`)
    const database = openMemoryDatabase()
    const appDataDir = await mkdtemp(path.join(tmpdir(), 'monthly-excel-'))
    try {
      const options = { db: database.client, appDataDir, files: createNodeImportFiles(), paths }
      const before = await importSelectedDocuments(options)
      const counts = await database.client.select('SELECT (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM snapshots) AS snapshots')
      const enriched = await importSelectedDocuments({ ...options, paths: [...paths, excelPath] })
      expect(enriched.period.month).toBe(fixture.month)
      expect(enriched.analysis?.expectedResult).toBe(before.analysis?.expectedResult)
      expect(enriched.periodReturnLabel).toBe(before.periodReturnLabel)
      expect(await database.client.select('SELECT (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM snapshots) AS snapshots')).toEqual(counts)
      const rows = await database.client.select<{ count: number }>('SELECT COUNT(*) AS count FROM transaction_fx_enrichments')
      console.log(fixture.folder, 'FX enrichments:', rows[0]?.count, 'result:', enriched.analysis?.expectedResult)
      expect(rows[0]?.count).toBeGreaterThan(0)
      const documents = await database.client.select('SELECT COUNT(*) AS count FROM documents')
      expect((await importSelectedDocuments({ ...options, paths: [...paths, excelPath] })).outcome).toBe('existing')
      expect(await database.client.select('SELECT COUNT(*) AS count FROM documents')).toEqual(documents)
      expect(await database.client.select('SELECT COUNT(*) AS count FROM transaction_fx_enrichments')).toEqual(rows)
      const fresh = openMemoryDatabase()
      try {
        const firstWithExcel = await importSelectedDocuments({
          ...options, db: fresh.client, appDataDir: await mkdtemp(path.join(tmpdir(), 'monthly-excel-first-')),
          paths: [...paths, excelPath],
        })
        expect(firstWithExcel.analysis?.expectedResult).toBe(before.analysis?.expectedResult)
        expect(firstWithExcel.periodReturnLabel).toBe(before.periodReturnLabel)
        expect(await fresh.client.select('SELECT COUNT(*) AS count FROM transaction_fx_enrichments')).toEqual(rows)
      } finally { fresh.close() }
    } finally { database.close() }
  }, 120_000)
})