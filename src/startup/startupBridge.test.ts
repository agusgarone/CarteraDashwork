import { describe, expect, it, vi } from 'vitest'
import { createStartupBridge } from './startupBridge'

describe('coordinación de startup Tauri', () => {
  it('espera la apertura nativa antes de permitir inicializar la aplicación', async () => {
    let resolve!: () => void
    const invoke = vi.fn(() => new Promise<void>(done => { resolve = done }))
    const bridge = createStartupBridge({ desktop: () => true, invoke })
    let finished = false
    const pending = bridge.waitForBackend().then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('startup_backend_ready')
    resolve()
    await pending
    expect(finished).toBe(true)
  })
  it('propaga fallos de startup para renderizar el error en main', async () => {
    const bridge = createStartupBridge({ desktop: () => true, invoke: vi.fn().mockRejectedValue(new Error('SQLite unavailable')) })
    await expect(bridge.waitForBackend()).rejects.toThrow('SQLite unavailable')
  })
  it('StrictMode y efectos repetidos piden una sola presentación', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const bridge = createStartupBridge({ desktop: () => true, invoke })
    await Promise.all([bridge.presentMain(), bridge.presentMain(), bridge.presentMain()])
    await bridge.presentMain()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('startup_frontend_ready')
  })
  it('permite reintentar si el comando nativo rechaza la presentación', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('IPC error')).mockResolvedValue(undefined)
    const bridge = createStartupBridge({ desktop: () => true, invoke })
    await expect(bridge.presentMain()).rejects.toThrow('IPC error')
    await bridge.presentMain()
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('el navegador de desarrollo no intenta abrir ventanas nativas', async () => {
    const invoke = vi.fn()
    const bridge = createStartupBridge({ desktop: () => false, invoke })
    await bridge.waitForBackend()
    await bridge.presentMain()
    expect(invoke).not.toHaveBeenCalled()
  })
})
