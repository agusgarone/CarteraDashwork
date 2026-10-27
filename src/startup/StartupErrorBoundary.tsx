import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { startupBridge } from './startupBridge'
import brandMark from '@/assets/isotipo-MAG.png'

export function StartupFailure() {
  useEffect(() => {
    void startupBridge.presentMain().catch(console.error)
  }, [])
  return <main className="grid min-h-svh place-items-center bg-[#101216] p-8 text-center text-white">
    <div className="max-w-sm space-y-4">
      <img src={brandMark} alt="" width="96" height="96" className="mx-auto" />
      <h1 className="text-lg font-semibold">No pudimos iniciar la aplicación</h1>
      <p className="text-sm text-white/70">Cerrá y volvé a abrir la app o intentá cargarla nuevamente. Tus datos no se borraron.</p>
      <button type="button" className="rounded-lg border border-white/30 px-4 py-2 text-sm" onClick={() => window.location.reload()}>Reintentar</button>
    </div>
  </main>
}

export class StartupErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Error al iniciar la interfaz', error, info) }
  render() { return this.state.failed ? <StartupFailure /> : this.props.children }
}
