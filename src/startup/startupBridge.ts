import { invoke, isTauri } from '@tauri-apps/api/core'

interface StartupBridgeDependencies {
  desktop: () => boolean
  invoke: (command: string) => Promise<unknown>
}

/** Native state survives HMR/reload; this promise also coalesces React StrictMode effects. */
export function createStartupBridge(dependencies: StartupBridgeDependencies) {
  let presentation: Promise<void> | null = null
  return {
    async waitForBackend() {
      if (dependencies.desktop()) await dependencies.invoke('startup_backend_ready')
    },
    presentMain(): Promise<void> {
      if (!dependencies.desktop()) return Promise.resolve()
      presentation ??= dependencies.invoke('startup_frontend_ready').then(() => {}).catch(error => {
        presentation = null
        throw error
      })
      return presentation
    },
  }
}

export const startupBridge = createStartupBridge({ desktop: isTauri, invoke })
