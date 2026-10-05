import { PortfolioEvolutionChart } from '@/components/charts/PortfolioEvolutionChart'
import { CompositionCard } from '@/components/dashboard/CompositionCard'
import { MetricCards } from '@/components/dashboard/MetricCards'
import { MonthHistory } from '@/components/dashboard/MonthHistory'
import { PerformanceOrigin } from '@/components/dashboard/PerformanceOrigin'
import { PeriodSummaryCard } from '@/components/dashboard/PeriodSummaryCard'
import { useImportDialog } from '@/components/import/ImportDialogProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { ReactNode } from 'react'
import { usePortfolioOverview } from '@/application/PortfolioOverviewProvider'
import { useImportedPeriod } from '@/application/ImportedPeriodProvider'

export function DashboardPage() {
  const { screen, retry } = usePortfolioOverview()
  const { selectImportedPeriod } = useImportedPeriod()
  const { setOpen } = useImportDialog()

  if (screen.status === 'loading') return <OverviewSkeleton />
  if (screen.status === 'error') {
    return (
      <ScreenMessage
        title="No se pudo mostrar el resumen"
        body={screen.message}
        action={<Button type="button" onClick={retry}>Reintentar</Button>}
      />
    )
  }
  if (screen.status === 'empty') {
    return (
      <ScreenMessage
        title="Aún no hay períodos importados."
        body="Cuando importes un mes completo, el resumen va a leer esos datos."
        action={<Button type="button" onClick={() => setOpen(true)}>Importar mes</Button>}
      />
    )
  }

  const overview = screen.view

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Resumen de tu cartera</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Evolución, resultado y composición de tus ahorros.
        </p>
      </header>

      <MetricCards overview={overview} />

      <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader>
            <p className="text-base font-medium">Evolución de tu cartera</p>
            <div className="flex flex-wrap gap-4 pt-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="h-0.5 w-5 bg-foreground" />
                Patrimonio total
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <PortfolioEvolutionChart points={overview.evolution} />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              La línea es el patrimonio informado en cada snapshot disponible. El capital aportado
              acumulado no se muestra: no hay historial de aportes anterior al primer snapshot.
            </p>
          </CardContent>
        </Card>
        <PeriodSummaryCard overview={overview} />
      </section>

      <PerformanceOrigin overview={overview} />

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CompositionCard overview={overview} />
        <MonthHistory
          months={overview.months}
          selectedId={overview.period.id}
          onSelect={(periodId) => {
            const period = overview.availablePeriods.find((item) => item.id === periodId)
            if (!period) return
            selectImportedPeriod({ id: period.id, year: period.year, month: period.month })
          }}
        />
      </section>
    </div>
  )
}

function ScreenMessage({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Resumen de tu cartera</h1>
      </header>
      <Card>
        <CardContent className="space-y-4 py-8">
          <p className="text-base font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>
          {action}
        </CardContent>
      </Card>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Resumen de tu cartera</h1>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonCard className="h-80" />
    </div>
  )
}

function SkeletonCard({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className ?? 'h-36'}`} />
}
