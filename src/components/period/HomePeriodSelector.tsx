import { cn } from 'cn'
import { useAnalysisRange } from '@/analysis/AnalysisRangeProvider'
import { rangePeriodLabel } from '@/analysis/analysisRange'
import { useImportedPeriod } from '@/application/ImportedPeriodProvider'
import { usePortfolioOverview } from '@/application/PortfolioOverviewProvider'



export function HomePeriodSelector() {
  const { screen } = usePortfolioOverview()
  const { period: selected, selectImportedPeriod } = useImportedPeriod()
  const range = useAnalysisRange()
  const periods = screen.status === 'ready' ? screen.view.availablePeriods : range.catalog
  const selectedId = selected?.id ?? (screen.status === 'ready' ? screen.view.period.id : '')
  const latest = periods[periods.length - 1]

  function choose(id: string) {
    const period = periods.find((item) => item.id === id)
    if (!period) return
    selectImportedPeriod({ id: period.id, year: period.year, month: period.month })
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-card p-0.5 ring-1 ring-foreground/10">
      <button
        type="button"
        disabled={!latest}
        onClick={() => latest && choose(latest.id)}
        className={cn(
          'h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors disabled:opacity-50',
          latest && selectedId === latest.id && 'bg-foreground text-background',
        )}
      >
        Ahora
      </button>
      <select
        aria-label="Período final"
        value={selectedId}
        disabled={periods.length === 0}
        onChange={(event) => choose(event.target.value)}
        className="h-7 rounded-md bg-transparent px-2 text-xs font-medium text-foreground disabled:opacity-50"
      >
        {periods.length === 0 ? <option value="">Sin meses</option> : null}
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {rangePeriodLabel(period)}
          </option>
        ))}
      </select>
    </div>
  )
}
