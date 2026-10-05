import { invoke } from '@tauri-apps/api/core'
import type { BackupDocument } from '../backup/portableBackup'
import { backupFileName, createBackup, restoreBackup, type BackupSessionPort } from './backupSession'

export type BackupActionResult =
  | { status: 'cancelled' }
  | { status: 'created'; path: string }
  | { status: 'restored'; path: string }

export async function createBackupFromDesktop(): Promise<BackupActionResult> {
  await assertDesktop()
  const { save } = await import('@tauri-apps/plugin-dialog')
  const now = new Date()
  const selected = await save({
    title: 'Crear backup',
    defaultPath: backupFileName(now),
    filters: [{ name: 'Backup', extensions: ['zip'] }],
  })
  if (selected === null) return { status: 'cancelled' }
  await createBackup(tauriBackupPort(), { destinationPath: selected, createdAt: now.toISOString() })
  return { status: 'created', path: selected }
}

export async function restoreBackupFromDesktop(): Promise<BackupActionResult> {
  await assertDesktop()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    multiple: false,
    title: 'Restaurar backup',
    filters: [{ name: 'Backup', extensions: ['zip'] }],
  })
  if (selected === null) return { status: 'cancelled' }
  const path = Array.isArray(selected) ? selected[0] : selected
  if (!path) return { status: 'cancelled' }
  const zipBytes = await readUserFile(path)
  await restoreBackup(tauriBackupPort(), { zipBytes, createdAt: new Date().toISOString() })
  return { status: 'restored', path }
}

export interface AppLocation {
  databasePath: string
  documentsDir: string
}

export async function loadAppLocation(): Promise<AppLocation> {
  await assertDesktop()
  const paths = await invoke<{ databasePath: string; documentsDir: string }>('app_paths')
  return { databasePath: paths.databasePath, documentsDir: paths.documentsDir }
}

async function assertDesktop(): Promise<void> {
  const { isTauri } = await import('@tauri-apps/api/core')
  if (!isTauri()) {
    throw new Error('La copia de seguridad está disponible en la aplicación de escritorio.')
  }
}

function tauriBackupPort(): BackupSessionPort {
  return {
    async appVersion() {
      const paths = await invoke<{ appVersion: string }>('app_paths')
      return paths.appVersion
    },
    async snapshotDatabase() {
      return invoke<string>('snapshot_database')
    },
    async readSnapshot(path) {
      return asBytes(await invoke<number[]>('read_app_file', { path }))
    },
    async readDocuments() {
      const files = await invoke<Array<{ relativePath: string; bytes: number[] }>>('read_documents')
      return files.map((file): BackupDocument => ({
        relativePath: file.relativePath,
        bytes: asBytes(file.bytes),
      }))
    },
    async writeUserFile(path, bytes) {
      await invoke('write_user_file', { path, bytes: Array.from(bytes) })
    },
    async removeSnapshot(path) {
      await invoke('remove_app_file', { path })
    },
    async hasUserData() {
      return invoke<boolean>('has_user_data')
    },
    async writeSafetyBackup(bytes) {
      return invoke<string>('write_safety_backup', { bytes: Array.from(bytes) })
    },
    async stageRestore(files) {
      await invoke('stage_restore', {
        files: files.map((file) => ({
          relativePath: file.relativePath,
          bytes: Array.from(file.bytes),
        })),
      })
    },
    async commitRestore(safetyZip) {
      await invoke('commit_restore', { safetyZip })
    },
  }
}

async function readUserFile(path: string): Promise<Uint8Array> {
  return asBytes(await invoke<number[]>('read_user_file', { path }))
}

function asBytes(value: number[] | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value)
}
