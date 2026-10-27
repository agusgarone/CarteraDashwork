import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useImportedPeriod } from '@/application/ImportedPeriodProvider'
import { usePortfolioOverview } from '@/application/PortfolioOverviewProvider'
import { resolveAnalysisRange, type AnalysisRangeMode, type RangePeriod, type RangeResolution } from './analysisRange'
import { rangeAnalysisService, type RangeAnalysisResult } from './rangeAnalysisService'
interface RangeContextValue {
  mode: AnalysisRangeMode; catalog: RangePeriod[]; endPeriodId: string; customStartPeriodId: string
  resolution: RangeResolution; showRange: boolean; loading: boolean; result: RangeAnalysisResult | null; error: string | null
  setMode: (mode: AnalysisRangeMode) => void; setCustomStart: (id: string) => void; chooseEnd: (id: string) => void
}
const RangeContext = createContext<RangeContextValue>({
  mode: 'SINGLE', catalog: [], endPeriodId: '', customStartPeriodId: '',
  resolution: { status: 'UNAVAILABLE', reason: 'END_NOT_IMPORTED' }, showRange: false, loading: false, result: null, error: null,
  setMode: () => {}, setCustomStart: () => {}, chooseEnd: () => {},
})
export function AnalysisRangeProvider({ children }: { children: ReactNode }) {
  const { period, revision, selectImportedPeriod } = useImportedPeriod()
  const { screen } = usePortfolioOverview()
  // Keep the imported catalog visible while the selected monthly overview reloads.
  const [cachedCatalog, setCachedCatalog] = useState<RangePeriod[]>([])
  if (screen.status === 'ready' && cachedCatalog !== screen.view.availablePeriods) {
    setCachedCatalog(screen.view.availablePeriods)
  }
  const catalog = screen.status === 'ready' ? screen.view.availablePeriods : cachedCatalog
  const endPeriodId = period?.id ?? (screen.status === 'ready' ? screen.view.period.id : '')
  const [mode, setModeState] = useState<AnalysisRangeMode>('SINGLE')
  const [customStartPeriodId, setCustomStart] = useState('')
  const resolution = resolveAnalysisRange(catalog, { mode, endPeriodId, customStartPeriodId })
  const showRange = mode !== 'SINGLE' && (resolution.status !== 'AVAILABLE' || resolution.periods.length > 1)
  const startId = resolution.status === 'AVAILABLE' ? resolution.range.startPeriodId : null
  const key = showRange && startId ? `${startId}:${endPeriodId}:${revision}` : null
  const [loaded, setLoaded] = useState<{ key: string; result: RangeAnalysisResult | null; error: string | null } | null>(null)
  useEffect(() => {
    if (!key || !startId) return
    let cancelled = false
    void rangeAnalysisService.analyzeRange({ startPeriodId: startId, endPeriodId }).then(result => {
      if (!cancelled) setLoaded({ key, result, error: null })
    }).catch(error => {
      if (!cancelled) setLoaded({ key, result: null, error: error instanceof Error ? error.message : 'No se pudo analizar el rango.' })
    })
    return () => { cancelled = true }
  }, [key, startId, endPeriodId])
  const current = loaded?.key === key
  return <RangeContext.Provider value={{ mode, catalog, endPeriodId, customStartPeriodId, resolution, showRange,
    loading: key !== null && !current, result: resolution.status !== 'AVAILABLE' ? resolution : current ? loaded.result : null,
    error: current ? loaded.error : null,
    setMode: next => { if (next === 'CUSTOM' && !customStartPeriodId) setCustomStart(endPeriodId); setModeState(next) },
    setCustomStart, chooseEnd: id => { const next = catalog.find(row => row.id === id); if (next) selectImportedPeriod(next) },
  }}>{children}</RangeContext.Provider>
}
export function useAnalysisRange() { return useContext(RangeContext) }
