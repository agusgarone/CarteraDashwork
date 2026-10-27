import { useAnalysisRange } from '@/analysis/AnalysisRangeProvider'
import { monthIndex, rangePeriodLabel, resolveAnalysisRange, type AnalysisRangeMode } from '@/analysis/analysisRange'
const presets: [AnalysisRangeMode, string][] = [['SINGLE','1M'],['LAST_3','3M'],['LAST_6','6M'],['LAST_12','12M'],['YTD','YTD'],['CUSTOM','Personalizado']]
export function AnalysisRangeSelector() {
  const state = useAnalysisRange()
  const end = state.catalog.find(row => row.id === state.endPeriodId)
  const start = state.catalog.find(row => row.id === state.customStartPeriodId)
  return <section className="space-y-3" aria-label="Rango de análisis">
    <div className="flex flex-wrap gap-2">
      {presets.map(([mode, label]) => {
        const resolution = resolveAnalysisRange(state.catalog, { mode, endPeriodId: state.endPeriodId })
        const disabled = mode !== 'CUSTOM' && resolution.status !== 'AVAILABLE'
        const title = resolution.status === 'INCOMPLETE_RANGE' ? `Faltan períodos: ${resolution.missingPeriods.join(', ')}` : undefined
        return <button type="button" key={mode} disabled={disabled} title={title} aria-pressed={state.mode === mode}
          onClick={() => state.setMode(mode)} className={`rounded-lg px-3 py-2 text-sm ring-1 ring-foreground/10 disabled:opacity-40 ${state.mode === mode ? 'bg-foreground text-background' : 'bg-card'}`}>{label}</button>
      })}
    </div>
    {state.mode === 'CUSTOM' && <div className="flex flex-wrap gap-4 text-sm">
      <label>Desde <select className="ml-2 rounded-md bg-card p-2 ring-1 ring-foreground/10" value={state.customStartPeriodId} onChange={event => state.setCustomStart(event.target.value)}>
        {state.catalog.map(row => <option key={row.id} value={row.id} disabled={!!end && monthIndex(row) > monthIndex(end)}>{rangePeriodLabel(row)}</option>)}
      </select></label>
      <label>Hasta <select className="ml-2 rounded-md bg-card p-2 ring-1 ring-foreground/10" value={state.endPeriodId} onChange={event => state.chooseEnd(event.target.value)}>
        {state.catalog.map(row => <option key={row.id} value={row.id} disabled={!!start && monthIndex(row) < monthIndex(start)}>{rangePeriodLabel(row)}</option>)}
      </select></label>
    </div>}
  </section>
}
