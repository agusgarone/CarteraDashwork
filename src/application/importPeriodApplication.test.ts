/// <reference types="node" />

import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../database/sqliteMemory'
import { createNodeImportFiles } from '../import/nodeImportFiles'
import { importSelectedDocuments } from './importPeriodApplication'

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

describe('importSelectedDocuments', () => {
  it('devuelve la vista de agosto leyendo SQLite', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cartera-ui-'))
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
    const view = await importSelectedDocuments({
      db: database.client,
      appDataDir: appData,
      files: createNodeImportFiles(),
      paths,
      now: () => '2026-10-05T18:00:00.000Z',
    })
    expect(view.outcome).toBe('created')
    expect(view.period).toMatchObject({ year: 2026, month: 8, status: 'COMPLETE' })
    expect(view.summary).toEqual({ positionsCount: 25, transactionsCount: 10, corporateActionsCount: 1 })
    expect(view.analysis).toMatchObject({
      expectedResult: '179959.00',
      reconciliationStatus: 'WARNING',
    })
    expect(view.analysis?.explainedResult).toBe('179958.136')
    expect(view.analysis?.unexplainedDifference).toBe('0.864')
    expect(view.documents.map((document) => document.type).sort()).toEqual([
      'CONSOLIDATED_POSITION',
      'CONSOLIDATED_POSITION',
      'MONTHLY_ACCOUNT',
      'MONTHLY_FUND_STATEMENT',
    ])
    const again = await importSelectedDocuments({
      db: database.client,
      appDataDir: appData,
      files: createNodeImportFiles(),
      paths,
      now: () => '2026-10-05T18:00:00.000Z',
    })
    expect(again.outcome).toBe('existing')
    expect(again.period.id).toBe(view.period.id)

    const storedName = view.documents.find((document) => document.fileName === 'cuenta.txt')
    expect(storedName?.fileName.endsWith('.txt')).toBe(true)
    const published = await database.client.select<{ local_path: string }>(
      'SELECT local_path FROM documents WHERE original_filename = $1',
      ['cuenta.txt'],
    )
    const relative = published[0]?.local_path ?? ''
    expect(relative.endsWith('.txt')).toBe(true)
    const stored = await readFile(path.join(appData, ...relative.split('/')))
    const original = await readFile(paths[2] ?? '')
    expect(Buffer.compare(stored, original)).toBe(0)
    database.close()
  })
})
