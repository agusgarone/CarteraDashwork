import { invoke, isTauri } from '@tauri-apps/api/core'

export type AppHealth =
  | { status: 'desktop-only' }
  | { status: 'ok'; missingDocuments: string[] }
  | { status: 'error'; message: string }

interface HealthResponse {
  ok: boolean
  message: string | null
  missingDocuments: string[]
}

export async function loadAppHealth(): Promise<AppHealth> {
  if (!isTauri()) return { status: 'desktop-only' }
  try {
    const report = await invoke<HealthResponse>('app_health')
    if (!report.ok) {
      return {
        status: 'error',
        message: report.message ?? 'La base no se puede usar. No se creó una base nueva.',
      }
    }
    return { status: 'ok', missingDocuments: report.missingDocuments }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'No se pudo revisar la base.',
    }
  }
}
