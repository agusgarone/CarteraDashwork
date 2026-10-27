import { useEffect } from 'react'
import { usePortfolioOverview } from '@/application/PortfolioOverviewProvider'
import { startupBridge } from './startupBridge'

/** Effects run after React commits Home's first usable (or explicit error) state. */
export function StartupReadySignal() {
  const { screen } = usePortfolioOverview()
  useEffect(() => {
    if (screen.status !== 'loading') {
      void startupBridge.presentMain().catch(console.error)
    }
  }, [screen.status])
  return null
}
