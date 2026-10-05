import { unzipStored, zipStored } from './zipStore'

export const BACKUP_VERSION = 1
export const APP_IDENTIFIER = 'com.analisiscartera.app'
export const DATABASE_FILE = 'cartera.db'
export const DOCUMENTS_DIRECTORY = 'documents'

export interface BackupManifest {
  backupVersion: number
  appVersion: string
  createdAt: string
  databaseFile: typeof DATABASE_FILE
  documentsDirectory: typeof DOCUMENTS_DIRECTORY
  appIdentifier: typeof APP_IDENTIFIER
}

export interface BackupDocument {
  /** Ruta dentro de documents/, con barras /. */
  relativePath: string
  bytes: Uint8Array
}

export interface PortableBackup {
  manifest: BackupManifest
  databaseBytes: Uint8Array
  documents: BackupDocument[]
}

/**
 * Backup portable v1.
 *
 * El archivo es un zip sin comprimir:
 * manifest.json, cartera.db y documents/...
 *
 * cartera.db tiene que ser un snapshot de SQLite (`VACUUM INTO`),
 * no una copia del archivo que la app tiene abierto.
 * Los PDF se copian del directorio documents/. No se reconstruyen desde la base.
 */
export function buildPortableBackup(input: {
  appVersion: string
  createdAt: string
  databaseBytes: Uint8Array
  documents: readonly BackupDocument[]
}): Uint8Array {
  const manifest = manifestOf(input.appVersion, input.createdAt)
  const entries = [
    { name: 'manifest.json', bytes: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`) },
    { name: DATABASE_FILE, bytes: input.databaseBytes },
    ...input.documents.map((document) => ({
      name: `${DOCUMENTS_DIRECTORY}/${normalizeDocumentPath(document.relativePath)}`,
      bytes: document.bytes,
    })),
  ]
  return zipStored(entries)
}

export function readPortableBackup(bytes: Uint8Array): PortableBackup {
  let entries
  try {
    entries = unzipStored(bytes)
  } catch (error) {
    throw new BackupError(error instanceof Error ? error.message : 'El archivo no es un backup válido.')
  }

  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')
  const database = entries.find((entry) => entry.name === DATABASE_FILE)
  if (!manifestEntry || !database) {
    throw new BackupError('El backup no tiene manifest.json y cartera.db.')
  }
  if (!startsWithSqliteHeader(database.bytes)) {
    throw new BackupError('cartera.db del backup no es una base SQLite.')
  }

  const manifest = parseManifest(manifestEntry.bytes)
  const documents: BackupDocument[] = []
  for (const entry of entries) {
    if (entry.name === 'manifest.json' || entry.name === DATABASE_FILE) continue
    if (!entry.name.startsWith(`${DOCUMENTS_DIRECTORY}/`)) {
      throw new BackupError(`El backup incluye un archivo inesperado: ${entry.name}`)
    }
    documents.push({
      relativePath: normalizeDocumentPath(entry.name.slice(DOCUMENTS_DIRECTORY.length + 1)),
      bytes: entry.bytes,
    })
  }

  return { manifest, databaseBytes: database.bytes, documents }
}

export function parseManifest(bytes: Uint8Array): BackupManifest {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new BackupError('El manifest del backup no es JSON.')
  }
  if (!value || typeof value !== 'object') {
    throw new BackupError('El manifest del backup no es válido.')
  }
  const record = value as Record<string, unknown>
  if (record.backupVersion !== BACKUP_VERSION) {
    throw new BackupError('Esta versión de la app no puede leer ese backup.')
  }
  if (record.appIdentifier !== APP_IDENTIFIER) {
    throw new BackupError('El backup no pertenece a esta aplicación.')
  }
  if (record.databaseFile !== DATABASE_FILE || record.documentsDirectory !== DOCUMENTS_DIRECTORY) {
    throw new BackupError('La estructura del backup no es la esperada.')
  }
  if (typeof record.appVersion !== 'string' || record.appVersion.trim() === '') {
    throw new BackupError('El manifest no tiene versión de la app.')
  }
  if (typeof record.createdAt !== 'string' || !record.createdAt.includes('T')) {
    throw new BackupError('El manifest no tiene fecha de creación.')
  }
  return {
    backupVersion: BACKUP_VERSION,
    appVersion: record.appVersion,
    createdAt: record.createdAt,
    databaseFile: DATABASE_FILE,
    documentsDirectory: DOCUMENTS_DIRECTORY,
    appIdentifier: APP_IDENTIFIER,
  }
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

function manifestOf(appVersion: string, createdAt: string): BackupManifest {
  return {
    backupVersion: BACKUP_VERSION,
    appVersion,
    createdAt,
    databaseFile: DATABASE_FILE,
    documentsDirectory: DOCUMENTS_DIRECTORY,
    appIdentifier: APP_IDENTIFIER,
  }
}

function normalizeDocumentPath(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/).filter((part) => part.length > 0)
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) {
    throw new BackupError('El backup tiene una ruta de documento inválida.')
  }
  if (relativePath.startsWith('/') || relativePath.startsWith('\\') || /^[a-zA-Z]:/.test(relativePath)) {
    throw new BackupError('El backup tiene una ruta de documento inválida.')
  }
  return parts.join('/')
}

function startsWithSqliteHeader(bytes: Uint8Array): boolean {
  const header = new TextDecoder().decode(bytes.subarray(0, 15))
  return header === 'SQLite format 3'
}
