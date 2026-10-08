import { getDatabase } from '../database/database'
import { absoluteDataPath } from '../import/documentStore'
import { ensureCashMovementLegs } from '../import/ensureCashMovementLegs'
import { loadPortfolioOverview } from './portfolioOverview'
import type { OverviewScreen } from './overviewScreen'

export async function loadOverviewScreen(periodId: string | null): Promise<Exclude<OverviewScreen, { status: 'loading' }>> {
  const { isTauri } = await import('@tauri-apps/api/core')
  if (!isTauri()) {
    return {
      status: 'error',
      message: 'El resumen con datos reales está disponible en la aplicación de escritorio.',
    }
  }

  try {
    const db = await getDatabase()
    const { appDataDir } = await import('@tauri-apps/api/path')
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const dataDir = await appDataDir()
    const view = await loadPortfolioOverview({
      db,
      periodId,
      preparePeriod: (selectedPeriodId) =>
        ensureCashMovementLegs({
          db,
          periodId: selectedPeriodId,
          readPdf: async (relativePath) => {
            try {
              const absolute = absoluteDataPath(dataDir, relativePath, joinDataPath)
              return new Uint8Array(await readFile(absolute))
            } catch {
              return null
            }
          },
        }),
    })
    return view ? { status: 'ready', view } : { status: 'empty' }
  } catch (error) {
    console.error(error)
    return { status: 'error', message: 'No se pudo leer el resumen.' }
  }
}

function joinDataPath(...parts: string[]): string {
  const windows = parts.some((part) => part.includes('\\') || /^[a-zA-Z]:/.test(part))
  const separator = windows ? '\\' : '/'
  return parts
    .flatMap((part) => part.split(/[\\/]/))
    .filter((part) => part.length > 0)
    .join(separator)
}
