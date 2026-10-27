import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const html = readFileSync(new URL('../../splash.html', import.meta.url), 'utf8')
function splash() {
  let ready!: () => Promise<void>
  let endFade!: () => void
  const finished = new Promise<void>(resolve => { endFade = resolve })
  const invoke = vi.fn().mockResolvedValue(undefined)
  const status = { textContent: '' }
  const recovery = { hidden: true, onclick: () => {} }
  const animate = vi.fn(() => ({ finished }))
  const document = { body: { style: { opacity: '1' }, animate, getAnimations: () => [] }, getElementById: (id: string) => id === 'status' ? status : recovery }
  const listen = vi.fn((_event: string, callback: () => Promise<void>) => { ready = callback; return Promise.resolve(() => {}) })
  const window = { __TAURI__: { core: { invoke }, event: { listen } }, location: { reload: vi.fn() } }
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
  runInNewContext(script, { document, window, matchMedia: () => ({ matches: false }) })
  return { ready: () => ready(), endFade, invoke, animate, status, recovery }
}
describe('splash independiente de React', () => {
  it('recibe READY, hace fade corto y después solicita la ventana principal', async () => {
    const view = splash()
    const finishing = view.ready()
    expect(view.animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })
    expect(view.invoke).not.toHaveBeenCalled()
    view.endFade()
    await finishing
    expect(view.invoke).toHaveBeenCalledExactlyOnceWith('startup_show_main')
  })
  it('un error al presentar main deja un mensaje y recuperación visibles', async () => {
    const view = splash()
    view.invoke.mockRejectedValue(new Error('window error'))
    const finishing = view.ready()
    view.endFade()
    await finishing
    expect(view.status.textContent).toContain('No se pudo completar el inicio')
    expect(view.recovery.hidden).toBe(false)
  })
})
