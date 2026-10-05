/// <reference types="node" />

import { access, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BackupError, readPortableBackup } from './portableBackup'

/**
 * Restaura un backup sobre archivos locales.
 * Valida en un directorio staging y recién después reemplaza.
 * Si el reemplazo de documents/ falla, la base vuelve al archivo anterior.
 *
 * En Windows no hay un único rename que cubra la base y los documentos.
 * La copia previa (safetyZipReady) es la red de seguridad si el proceso se corta en el medio.
 */
export async function restoreBackupOnto(options: {
  zipBytes: Uint8Array
  databasePath: string
  documentsDir: string
  /** Obligatorio cuando el destino ya tiene base o documentos. */
  safetyZipReady: boolean
}): Promise<void> {
  const backup = readPortableBackup(options.zipBytes)
  const stagingRoot = `${options.databasePath}.staging`
  const stagingDb = path.join(stagingRoot, 'cartera.db')
  const stagingDocuments = path.join(stagingRoot, 'documents')
  await rm(stagingRoot, { recursive: true, force: true })
  await mkdir(stagingDocuments, { recursive: true })
  await writeFile(stagingDb, backup.databaseBytes)
  for (const document of backup.documents) {
    const destination = path.join(stagingDocuments, ...document.relativePath.split('/'))
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, document.bytes)
  }

  let databaseMove: Move | null = null
  let documentsMove: Move | null = null
  try {
    assertBackupDatabase(stagingDb)
    if ((await destinationHasData(options.databasePath, options.documentsDir)) && !options.safetyZipReady) {
      throw new BackupError('Antes de restaurar hay que guardar una copia de los datos actuales.')
    }
    databaseMove = await moveAside(options.databasePath)
    await rename(stagingDb, options.databasePath)
    documentsMove = await moveAside(options.documentsDir)
    await mkdir(path.dirname(options.documentsDir), { recursive: true })
    await rename(stagingDocuments, options.documentsDir)
    await discard(databaseMove)
    await discard(documentsMove)
  } catch (error) {
    if (documentsMove) await undo(options.documentsDir, documentsMove)
    if (databaseMove) await undo(options.databasePath, databaseMove)
    throw error
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function assertBackupDatabase(filePath: string): void {
  const sqlite = new DatabaseSync(filePath)
  try {
    sqlite.exec('PRAGMA foreign_keys = ON')
    const foreignKeys = sqlite.prepare('PRAGMA foreign_keys').get() as { foreign_keys?: number } | undefined
    if (foreignKeys?.foreign_keys !== 1) {
      throw new BackupError('La base del backup no tiene foreign keys activas.')
    }
    const check = sqlite.prepare('PRAGMA quick_check').all() as { quick_check?: string }[]
    if (check.map((row) => row.quick_check).join(' ') !== 'ok') {
      throw new BackupError('La base del backup no pasa el control de integridad.')
    }
    const versions = sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: string
    }[]
    if (versions.map((row) => row.version).join(',') !== '001,002') {
      throw new BackupError('La base del backup no tiene el schema de esta versión.')
    }
  } finally {
    sqlite.close()
  }
}

interface Move {
  previous: string | null
}

async function moveAside(current: string): Promise<Move> {
  const previous = `${current}.previous`
  await rm(previous, { recursive: true, force: true })
  if (!(await exists(current))) return { previous: null }
  await rename(current, previous)
  return { previous }
}

async function undo(current: string, move: Move): Promise<void> {
  if (await exists(current)) await rm(current, { recursive: true, force: true })
  if (move.previous && (await exists(move.previous))) await rename(move.previous, current)
}

async function discard(move: Move): Promise<void> {
  if (move.previous) await rm(move.previous, { recursive: true, force: true })
}

async function destinationHasData(databasePath: string, documentsDir: string): Promise<boolean> {
  if (await exists(databasePath)) return true
  if (!(await exists(documentsDir))) return false
  const entries = await readdir(documentsDir)
  return entries.length > 0
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
