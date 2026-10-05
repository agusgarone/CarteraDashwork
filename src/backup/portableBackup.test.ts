import { mkdtempSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFileDatabase } from '../database/sqliteMemory'
import { APP_IDENTIFIER, buildPortableBackup, readPortableBackup } from './portableBackup'
import { restoreBackupOnto } from './restoreFiles'
import { unzipStored, zipStored } from './zipStore'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('backup portable', () => {
  it('guarda manifest, base y documentos sin datos financieros en el manifest', () => {
    const database = sqliteBytes()
    const zip = buildPortableBackup({
      appVersion: '0.1.0',
      createdAt: '2026-10-05T20:00:00.000Z',
      databaseBytes: database,
      documents: [{ relativePath: '2026/08/resumen.pdf', bytes: new TextEncoder().encode('pdf-bytes') }],
    })
    const read = readPortableBackup(zip)
    expect(read.manifest).toEqual({
      backupVersion: 1,
      appVersion: '0.1.0',
      createdAt: '2026-10-05T20:00:00.000Z',
      databaseFile: 'cartera.db',
      documentsDirectory: 'documents',
      appIdentifier: APP_IDENTIFIER,
    })
    expect(JSON.stringify(read.manifest)).not.toMatch(/179959|26383988/)
    expect(new TextDecoder().decode(read.documents[0]?.bytes)).toBe('pdf-bytes')
  })

  it('rechaza una ruta que sale del directorio de documentos', () => {
    expect(() =>
      buildPortableBackup({
        appVersion: '0.1.0',
        createdAt: '2026-10-05T20:00:00.000Z',
        databaseBytes: sqliteBytes(),
        documents: [{ relativePath: '../cartera.db', bytes: new Uint8Array([1]) }],
      }),
    ).toThrow(/ruta de documento/)
  })

  it('no reemplaza el destino si el manifest no es de esta app', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cartera-backup-'))
    roots.push(root)
    const databasePath = path.join(root, 'cartera.db')
    await writeFile(databasePath, 'datos-actuales')
    const entries = unzipStored(
      buildPortableBackup({
        appVersion: '0.1.0',
        createdAt: '2026-10-05T20:00:00.000Z',
        databaseBytes: sqliteBytes(),
        documents: [],
      }),
    )
    const manifest = entries.find((entry) => entry.name === 'manifest.json')
    if (!manifest) throw new Error('sin manifest')
    manifest.bytes = new TextEncoder().encode(
      new TextDecoder().decode(manifest.bytes).replaceAll(APP_IDENTIFIER, 'com.tauri.dev'),
    )
    await expect(
      restoreBackupOnto({
        zipBytes: zipStored(entries),
        databasePath,
        documentsDir: path.join(root, 'documents'),
        safetyZipReady: true,
      }),
    ).rejects.toThrow(/no pertenece/)
    expect(await readFile(databasePath, 'utf8')).toBe('datos-actuales')
  })

  it('VACUUM INTO no arrastra un cambio posterior al snapshot', async () => {
    const root = tempRoot()
    const database = openFileDatabase(path.join(root, 'cartera.db'))
    await database.client.execute(
      "INSERT INTO portfolios (name, broker, base_currency) VALUES ('Una', 'BALANZ', 'ARS')",
    )
    const snapshot = path.join(root, 'snapshot.db')
    database.snapshot(snapshot)
    await database.client.execute(
      "INSERT INTO portfolios (name, broker, base_currency) VALUES ('Dos', 'BALANZ', 'ARS')",
    )
    database.close()

    const copied = openFileDatabase(snapshot)
    const rows = await copied.client.select<{ name: string }>('SELECT name FROM portfolios ORDER BY id')
    copied.close()
    expect(rows.map((row) => row.name)).toEqual(['Una'])
  })
})

function sqliteBytes(): Uint8Array {
  const root = tempRoot()
  const filePath = path.join(root, 'cartera.db')
  const database = openFileDatabase(filePath)
  database.close()
  return new Uint8Array(readFileSync(filePath))
}

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cartera-backup-'))
  roots.push(root)
  return root
}
