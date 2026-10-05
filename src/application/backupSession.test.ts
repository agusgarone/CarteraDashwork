import { describe, expect, it } from 'vitest'
import { buildPortableBackup } from '../backup/portableBackup'
import { backupFileName, createBackup, restoreBackup, type BackupSessionPort } from './backupSession'

const databaseBytes = new TextEncoder().encode('SQLite format 3\0pad')

function port(overrides: Partial<BackupSessionPort> = {}): BackupSessionPort & { calls: string[] } {
  const calls: string[] = []
  const base: BackupSessionPort = {
    async appVersion() {
      calls.push('version')
      return '0.1.0'
    },
    async snapshotDatabase() {
      calls.push('snapshot')
      return 'backup-work/snapshot.db'
    },
    async readSnapshot() {
      calls.push('read-snapshot')
      return databaseBytes
    },
    async readDocuments() {
      calls.push('documents')
      return [{ relativePath: '2026/08/resumen.pdf', bytes: new Uint8Array([1, 2, 3]) }]
    },
    async writeUserFile() {
      calls.push('write')
    },
    async removeSnapshot() {
      calls.push('remove-snapshot')
    },
    async hasUserData() {
      calls.push('has-data')
      return true
    },
    async writeSafetyBackup() {
      calls.push('safety')
      return 'backups/pre.zip'
    },
    async stageRestore(files) {
      calls.push(`stage:${files.map((file) => file.relativePath).join(',')}`)
    },
    async commitRestore(safetyZip) {
      calls.push(`commit:${safetyZip ?? 'none'}`)
    },
  }
  return { calls, ...base, ...overrides }
}

describe('sesión de backup', () => {
  it('arma el zip con el snapshot y borra el archivo temporal', async () => {
    const session = port()
    let written: Uint8Array | null = null
    session.writeUserFile = async (_path, bytes) => {
      session.calls.push('write')
      written = bytes
    }
    await createBackup(session, {
      destinationPath: 'C:/copias/analisis-cartera-backup-2026-10-05.zip',
      createdAt: '2026-10-05T20:00:00.000Z',
    })
    expect(session.calls).toEqual(['snapshot', 'read-snapshot', 'documents', 'version', 'write', 'remove-snapshot'])
    expect(written).not.toBeNull()
  })

  it('borra el snapshot aunque falle la escritura', async () => {
    const session = port({
      async writeUserFile() {
        session.calls.push('write')
        throw new Error('sin permiso')
      },
    })
    await expect(
      createBackup(session, { destinationPath: 'copia.zip', createdAt: '2026-10-05T20:00:00.000Z' }),
    ).rejects.toThrow('sin permiso')
    expect(session.calls.at(-1)).toBe('remove-snapshot')
  })

  it('no prepara la restauración si el archivo no es un backup', async () => {
    const session = port()
    await expect(
      restoreBackup(session, { zipBytes: new Uint8Array([1, 2, 3]), createdAt: '2026-10-05T20:00:00.000Z' }),
    ).rejects.toThrow()
    expect(session.calls).toEqual([])
  })

  it('guarda una copia previa antes de reemplazar datos', async () => {
    const session = port()
    const zip = buildPortableBackup({
      appVersion: '0.1.0',
      createdAt: '2026-10-05T20:00:00.000Z',
      databaseBytes,
      documents: [{ relativePath: '2026/08/resumen.pdf', bytes: new Uint8Array([9]) }],
    })
    const result = await restoreBackup(session, { zipBytes: zip, createdAt: '2026-10-05T21:00:00.000Z' })
    expect(result.safetyPath).toBe('backups/pre.zip')
    expect(session.calls.indexOf('safety')).toBeLessThan(session.calls.findIndex((call) => call.startsWith('stage:')))
    expect(session.calls).toContain('stage:cartera.db,documents/2026/08/resumen.pdf')
    expect(session.calls.at(-1)).toBe('commit:backups/pre.zip')
  })

  it('omite la copia previa cuando la instalación no tiene datos', async () => {
    const session = port({
      async hasUserData() {
        session.calls.push('has-data')
        return false
      },
    })
    const zip = buildPortableBackup({
      appVersion: '0.1.0',
      createdAt: '2026-10-05T20:00:00.000Z',
      databaseBytes,
      documents: [],
    })
    const result = await restoreBackup(session, { zipBytes: zip, createdAt: '2026-10-05T21:00:00.000Z' })
    expect(result.safetyPath).toBeNull()
    expect(session.calls).not.toContain('snapshot')
    expect(session.calls.at(-1)).toBe('commit:none')
  })

  it('nombra el archivo con la fecha local', () => {
    expect(backupFileName(new Date(2026, 9, 5))).toBe('analisis-cartera-backup-2026-10-05.zip')
  })
})
