import { PortfolioEvolutionChart } from '@/components/charts/PortfolioEvolutionChart'
import { CompositionCard } from '@/components/dashboard/CompositionCard'
import { MetricCards } from '@/components/dashboard/MetricCards'
import { MonthHistory } from '@/components/dashboard/MonthHistory'
import { PerformanceOrigin } from '@/components/dashboard/PerformanceOrigin'
import { PeriodSummaryCard } from '@/components/dashboard/PeriodSummaryCard'
import { usePeriod } from '@/components/period/PeriodProvider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getMonthHistory,
  getPortfolioEvolution,
  getPortfolioSummary,
} from '@/services/portfolioService'

export function DashboardPage() {
  const { selection } = usePeriod()
  const summary = getPortfolioSummary(selection)
  const evolution = getPortfolioEvolution(selection)
  const months = getMonthHistory()

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Resumen de tu cartera</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Evolución, rendimiento y composición de tus ahorros.
        </p>
      </header>

      <MetricCards
        patrimony={summary.patrimony}
        patrimonyChange={summary.patrimonyChange}
        investedCapital={summary.investedCapital}
        netContributions={summary.netContributions}
        investmentResult={summary.investmentResult}
        returnPercentage={summary.returnPercentage}
      />

      <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader>
            <CardTitle>Evolución de tu cartera</CardTitle>
            <div className="flex flex-wrap gap-4 pt-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="h-0.5 w-5 bg-foreground" />
                Patrimonio total
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-0 w-5 border-t border-dashed border-[#9aa3af]" />
                Capital aportado
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <PortfolioEvolutionChart points={evolution} />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              La línea sólida es el patrimonio. La punteada es el capital que fuiste aportando. La
              separación entre ambas es lo que generaron las inversiones.
            </p>
          </CardContent>
        </Card>
        <PeriodSummaryCard
          periodLabel={summary.periodLabel}
          summary={summary.summary}
          missingLabels={summary.missingLabels}
        />
      </section>

      <PerformanceOrigin breakdown={summary.breakdown} />

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CompositionCard categories={summary.categories} />
        <MonthHistory months={months} />
      </section>
    </div>
  )
}
