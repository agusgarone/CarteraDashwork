import { createContext, useCallback, useContext, useEffect, useReducer, useState } from 'react'
import type { ReactNode } from 'react'
import { useImportedPeriod } from './ImportedPeriodProvider'
import { loadOverviewScreen } from './overviewFromDesktop'
import { initialOverviewScreen, overviewScreenReducer } from './overviewScreen'
import type { OverviewScreen } from './overviewScreen'

interface OverviewContextValue {
  screen: OverviewScreen
  retry: () => void
}

const OverviewContext = createContext<OverviewContextValue | null>(null)

export function PortfolioOverviewProvider({ children }: { children: ReactNode }) {
  const { period, revision } = useImportedPeriod()
  const [attempt, setAttempt] = useState(0)
  const [screen, dispatch] = useReducer(overviewScreenReducer, initialOverviewScreen)

  useEffect(() => {
    let cancelled = false
    dispatch({ type: 'load' })
    void loadOverviewScreen(period?.id ?? null).then((next) => {
      if (cancelled) return
      if (next.status === 'empty') dispatch({ type: 'empty' })
      else if (next.status === 'error') dispatch({ type: 'error', message: next.message })
      else dispatch({ type: 'ready', view: next.view })
    })
    return () => {
      cancelled = true
    }
  }, [period?.id, revision, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  return <OverviewContext.Provider value={{ screen, retry }}>{children}</OverviewContext.Provider>
}

export function usePortfolioOverview() {
  const context = useContext(OverviewContext)
  if (!context) {
    throw new Error('usePortfolioOverview debe usarse dentro de PortfolioOverviewProvider.')
  }
  return context
}
