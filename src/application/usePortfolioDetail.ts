import { useCallback, useEffect, useReducer, useState } from 'react'
import { useImportedPeriod } from './ImportedPeriodProvider'
import { loadDetailScreen } from './detailFromDesktop'
import { detailScreenReducer, initialDetailScreen } from './detailScreen'

export function usePortfolioDetail() {
  const { period, revision } = useImportedPeriod()
  const [attempt, setAttempt] = useState(0)
  const [screen, dispatch] = useReducer(detailScreenReducer, initialDetailScreen)

  useEffect(() => {
    let cancelled = false
    dispatch({ type: 'load' })
    void loadDetailScreen(period?.id ?? null).then((next) => {
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
  return { screen, retry }
}
