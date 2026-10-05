import { getDatabase } from '../database/database'
import { loadPortfolioDetail } from './portfolioDetail'
import type { DetailScreen } from './detailScreen'

export async function loadDetailScreen(periodId: string | null): Promise<Exclude<DetailScreen, { status: 'loading' }>> {
  const { isTauri } = await import('@tauri-apps/api/core')
  if (!isTauri()) {
    return {
      status: 'error',
      message: 'El detalle con datos reales está disponible en la aplicación de escritorio.',
    }
  }

  try {
    const view = await loadPortfolioDetail({ db: await getDatabase(), periodId })
    return view ? { status: 'ready', view } : { status: 'empty' }
  } catch (error) {
    console.error(error)
    return { status: 'error', message: 'No se pudo leer el detalle.' }
  }
}
