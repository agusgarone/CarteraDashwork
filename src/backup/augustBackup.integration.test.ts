/// <reference types="node" />

import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_VERSION } from '../application/appVersion'
import { importSelectedDocuments } from '../application/importPeriodApplication'
import { loadPortfolioOverview } from '../application/portfolioOverview'
import { buildPortableBackup } from '../backup/portableBackup'
import { restoreBackupOnto } from '../backup/restoreFiles'
import { openFileDatabase, type NodeDatabase } from '../database/sqliteMemory'
import { createNodeImportFiles } from '../import/nodeImportFiles'
import { formatReturnPercent } from '../utils/formatPercentage'

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

describe('backup y restore de agosto', () => {
  it('restaura patrimonio, resultado, diferencia y Modified Dietz', async () => {
    const imported = await importAugust()
    const documents = await listDocuments(imported.documentsDir)
    expect(documents.length).toBeGreaterThan(0)
    const originalDocument = documents[0]
    if (!originalDocument) throw new Error('sin documentos')

    const snapshotPath = path.join(imported.root, 'snapshot.db')
    imported.database.snapshot(snapshotPath)
    imported.database.close()
    const snapshotBytes = new Uint8Array(await readFile(snapshotPath))
    const zip = buildPortableBackup({
      appVersion: APP_VERSION,
      createdAt: '2026-10-05T20:00:00.000Z',
      databaseBytes: snapshotBytes,
      documents,
    })

    const live = openFileDatabase(imported.databasePath)
    await live.client.execute("UPDATE snapshots SET total_value = '1.00'")
    live.close()
    await rm(path.join(imported.documentsDir, ...originalDocument.relativePath.split('/')))
    await writeFile(path.join(imported.root, 'seguridad.zip'), zip)

    await restoreBackupOnto({
      zipBytes: zip,
      databasePath: imported.databasePath,
      documentsDir: imported.documentsDir,
      safetyZipReady: true,
    })
    await expectAugust(imported.databasePath)
    const restoredDocument = await readFile(path.join(imported.documentsDir, ...originalDocument.relativePath.split('/')))
    expect(new Uint8Array(restoredDocument)).toEqual(originalDocument.bytes)

    const again = openFileDatabase(imported.databasePath)
    await again.client.execute("UPDATE snapshots SET total_value = '2.00'")
    again.close()
    await restoreBackupOnto({
      zipBytes: zip,
      databasePath: imported.databasePath,
      documentsDir: imported.documentsDir,
      safetyZipReady: true,
    })
    await expectAugust(imported.databasePath)
  })

  it('un backup inválido deja la cartera restaurada como estaba', async () => {
    const imported = await importAugust()
    const documents = await listDocuments(imported.documentsDir)
    const snapshotPath = path.join(imported.root, 'snapshot.db')
    imported.database.snapshot(snapshotPath)
    imported.database.close()
    const zip = buildPortableBackup({
      appVersion: APP_VERSION,
      createdAt: '2026-10-05T20:00:00.000Z',
      databaseBytes: new Uint8Array(await readFile(snapshotPath)),
      documents,
    })
    await restoreBackupOnto({
      zipBytes: zip,
      databasePath: imported.databasePath,
      documentsDir: imported.documentsDir,
      safetyZipReady: true,
    })

    await expect(
      restoreBackupOnto({
        zipBytes: new TextEncoder().encode('no-es-un-zip'),
        databasePath: imported.databasePath,
        documentsDir: imported.documentsDir,
        safetyZipReady: true,
      }),
    ).rejects.toThrow(/zip/)
    await expectAugust(imported.databasePath)
  })
})

async function expectAugust(databasePath: string) {
  const database = openFileDatabase(databasePath)
  const view = await loadPortfolioOverview({ db: database.client })
  database.close()
  expect(view).not.toBeNull()
  if (!view) return
  expect(view.metrics.currentPortfolioValue).toBe('26383988')
  expect(view.metrics.investmentResult).toBe('179959.00')
  expect(view.metrics.explainedResult).toBe('179958.136')
  expect(view.metrics.unexplainedDifference).toBe('0.864')
  expect(view.periodReturn?.decimal).toBe('0.0067492117250949813805076604')
  expect(formatReturnPercent(view.periodReturn?.decimal ?? '0')).toBe('+0,67%')
}

async function importAugust(): Promise<{
  root: string
  databasePath: string
  documentsDir: string
  database: NodeDatabase
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'cartera-backup-agosto-'))
  roots.push(root)
  const appData = path.join(root, 'app-data')
  const inputDir = path.join(root, 'entrada')
  const databasePath = path.join(appData, 'cartera.db')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(appData, { recursive: true })
  const importing = openFileDatabase(databasePath)
  try {
    await importSelectedDocuments({
      db: importing.client,
      appDataDir: appData,
      files: createNodeImportFiles(),
      paths: await stageFixtures(inputDir),
      now: () => '2026-10-05T18:00:00.000Z',
    })
  } finally {
    importing.close()
  }
  return {
    root,
    databasePath,
    documentsDir: path.join(appData, 'documents'),
    database: openFileDatabase(databasePath),
  }
}

async function stageFixtures(inputDir: string): Promise<string[]> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(inputDir, { recursive: true })
  const paths: string[] = []
  for (const [source, name] of SOURCES) {
    const destination = path.join(inputDir, name)
    await copyFile(path.join(FIXTURES, source), destination)
    paths.push(destination)
  }
  return paths
}

async function listDocuments(documentsDir: string) {
  const files: { relativePath: string; bytes: Uint8Array }[] = []
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      files.push({
        relativePath: path.relative(documentsDir, absolute).split(path.sep).join('/'),
        bytes: new Uint8Array(await readFile(absolute)),
      })
    }
  }
  await walk(documentsDir)
  return files
}
