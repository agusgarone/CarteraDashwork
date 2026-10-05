import { getDatabase } from '../database/database'
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
    const view = await loadPortfolioOverview({ db: await getDatabase(), periodId })
    return view ? { status: 'ready', view } : { status: 'empty' }
  } catch (error) {
    console.error(error)
    return { status: 'error', message: 'No se pudo leer el resumen.' }
  }
}
