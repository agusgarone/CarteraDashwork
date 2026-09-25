import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { resolvePeriod } from '@/services/portfolioService'
import type { ResolvedPeriod } from '@/services/portfolioService'
import type { PeriodPreset, PeriodSelection } from '@/types/portfolio'

interface PeriodContextValue {
  selection: PeriodSelection
  period: ResolvedPeriod
  setPreset: (preset: PeriodPreset) => void
  applyCustomRange: (startMonthId: string, endMonthId: string) => void
}

const PeriodContext = createContext<PeriodContextValue | null>(null)

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<PeriodSelection>({
    preset: 'now',
    startMonthId: '2026-06',
    endMonthId: '2026-08',
  })

  const value = useMemo<PeriodContextValue>(() => {
    return {
      selection,
      period: resolvePeriod(selection),
      setPreset: (preset) => {
        setSelection((current) => ({ ...current, preset }))
      },
      applyCustomRange: (startMonthId, endMonthId) => {
        const ordered = startMonthId <= endMonthId
          ? [startMonthId, endMonthId]
          : [endMonthId, startMonthId]
        setSelection({
          preset: 'custom',
          startMonthId: ordered[0],
          endMonthId: ordered[1],
        })
      },
    }
  }, [selection])

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
}

export function usePeriod() {
  const context = useContext(PeriodContext)
  if (!context) {
    throw new Error('usePeriod debe usarse dentro de PeriodProvider.')
  }
  return context
}
