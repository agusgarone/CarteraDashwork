import { buildPortableBackup, readPortableBackup, type BackupDocument } from '../backup/portableBackup'

export interface BackupFile {
  relativePath: string
  bytes: Uint8Array
}

export interface BackupSessionPort {
  appVersion(): Promise<string>
  snapshotDatabase(): Promise<string>
  readSnapshot(path: string): Promise<Uint8Array>
  readDocuments(): Promise<BackupDocument[]>
  writeUserFile(path: string, bytes: Uint8Array): Promise<void>
  removeSnapshot(path: string): Promise<void>
  hasUserData(): Promise<boolean>
  writeSafetyBackup(bytes: Uint8Array): Promise<string>
  stageRestore(files: BackupFile[]): Promise<void>
  commitRestore(safetyZip: string | null): Promise<void>
}

export async function createBackup(
  port: BackupSessionPort,
  input: { destinationPath: string; createdAt: string },
): Promise<void> {
  const snapshotPath = await port.snapshotDatabase()
  try {
    const databaseBytes = await port.readSnapshot(snapshotPath)
    const documents = await port.readDocuments()
    const zip = buildPortableBackup({
      appVersion: await port.appVersion(),
      createdAt: input.createdAt,
      databaseBytes,
      documents,
    })
    await port.writeUserFile(input.destinationPath, zip)
  } finally {
    await port.removeSnapshot(snapshotPath)
  }
}

/**
 * Valida el zip antes de escribir.
 * Si ya hay datos, primero guarda una copia de la instalación actual.
 */
export async function restoreBackup(
  port: BackupSessionPort,
  input: { zipBytes: Uint8Array; createdAt: string },
): Promise<{ safetyPath: string | null }> {
  const backup = readPortableBackup(input.zipBytes)
  let safetyPath: string | null = null
  if (await port.hasUserData()) {
    const snapshotPath = await port.snapshotDatabase()
    try {
      const zip = buildPortableBackup({
        appVersion: await port.appVersion(),
        createdAt: input.createdAt,
        databaseBytes: await port.readSnapshot(snapshotPath),
        documents: await port.readDocuments(),
      })
      safetyPath = await port.writeSafetyBackup(zip)
    } finally {
      await port.removeSnapshot(snapshotPath)
    }
  }

  await port.stageRestore([
    { relativePath: 'cartera.db', bytes: backup.databaseBytes },
    ...backup.documents.map((document) => ({
      relativePath: `documents/${document.relativePath}`,
      bytes: document.bytes,
    })),
  ])
  await port.commitRestore(safetyPath)
  return { safetyPath }
}

export function backupFileName(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `analisis-cartera-backup-${year}-${month}-${day}.zip`
}
