import { getDatabase } from '../database/database'
import { importSelectedDocuments, type ImportPeriodResultView } from './importPeriodApplication'
import { createTauriImportFiles } from './tauriImportFiles'

export async function importFromDesktop(paths: string[]): Promise<ImportPeriodResultView> {
  const { isTauri } = await import('@tauri-apps/api/core')
  if (!isTauri()) {
    throw new Error('La importación persistente está disponible en la aplicación de escritorio.')
  }
  const { appDataDir } = await import('@tauri-apps/api/path')
  return importSelectedDocuments({
    db: await getDatabase(),
    appDataDir: await appDataDir(),
    files: createTauriImportFiles(),
    paths,
  })
}
