import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { startupBridge } from './startup/startupBridge'
import { StartupErrorBoundary, StartupFailure } from './startup/StartupErrorBoundary'

const root = createRoot(document.getElementById('root')!)

async function start() {
  try {
    // No repositories, health requests or Home effects run before native bootstrap finishes.
    await startupBridge.waitForBackend()
    const { default: App } = await import('./App')
    root.render(<StrictMode><StartupErrorBoundary><App /></StartupErrorBoundary></StrictMode>)
  } catch (error) {
    console.error('Error al iniciar la aplicación', error)
    root.render(<StartupFailure />)
  }
}
void start()
