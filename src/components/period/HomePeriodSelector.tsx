import { cn } from 'cn'
import { useImportedPeriod } from '@/application/ImportedPeriodProvider'
import { usePortfolioOverview } from '@/application/PortfolioOverviewProvider'

const lockedPresets = ['3M', '6M', 'YTD', '1A', 'Personalizado']

export function HomePeriodSelector() {
  const { screen } = usePortfolioOverview()
  const { selectImportedPeriod } = useImportedPeriod()
  const periods = screen.status === 'ready' ? screen.view.availablePeriods : []
  const selectedId = screen.status === 'ready' ? screen.view.period.id : ''
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
      {lockedPresets.map((label) => (
        <button
          key={label}
          type="button"
          disabled
          title="Este rango se habilita cuando haya más meses importados."
          className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground opacity-50"
        >
          {label}
        </button>
      ))}
      <select
        aria-label="Período mensual"
        value={selectedId}
        disabled={periods.length === 0}
        onChange={(event) => choose(event.target.value)}
        className="h-7 rounded-md bg-transparent px-2 text-xs font-medium text-foreground disabled:opacity-50"
      >
        {periods.length === 0 ? <option value="">Sin meses</option> : null}
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {period.label}
          </option>
        ))}
      </select>
    </div>
  )
}
