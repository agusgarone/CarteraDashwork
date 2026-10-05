import { cn } from 'cn'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SignedDecimal } from '@/components/shared/SignedDecimal'
import { reconciliationNote } from '@/application/overviewCopy'
import type { PortfolioOverviewView } from '@/application/portfolioOverview'
import { formatCurrencyARS } from '@/utils/formatCurrency'
import { formatReturnPercent } from '@/utils/formatPercentage'

const DIETZ_NOTE =
  'Calculado mediante Modified Dietz, teniendo en cuenta el momento de los aportes y retiros.'

export function MetricCards({ overview }: { overview: PortfolioOverviewView }) {
  const { metrics } = overview
  const negative =
    metrics.investmentResult !== null &&
    metrics.investmentResult.trim().startsWith('-') &&
    /[1-9]/.test(metrics.investmentResult)
  const note = reconciliationNote(metrics.reconciliationStatus, metrics.unexplainedDifference)

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">Patrimonio actual</p>
          <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatCurrencyARS(metrics.currentPortfolioValue)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            {metrics.portfolioValueChange ? <SignedDecimal value={metrics.portfolioValueChange} /> : '—'}
            <span className="text-muted-foreground"> en período</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">Capital neto aportado</p>
          <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">—</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            El capital acumulado desde el inicio todavía no está disponible.
          </p>
        </CardContent>
      </Card>

      <Card
        className={cn(
          metrics.investmentResult === null
            ? ''
            : negative
              ? 'bg-negative/5 ring-negative/20'
              : 'bg-positive/5 ring-positive/20',
        )}
      >
        <CardHeader>
          <p
            className={cn(
              'text-sm font-medium',
              metrics.investmentResult === null ? 'text-muted-foreground' : negative ? 'text-negative' : 'text-positive',
            )}
          >
            Generado por inversiones
          </p>
          <CardTitle className="text-4xl font-semibold tracking-tight">
            {metrics.investmentResult ? (
              <SignedDecimal value={metrics.investmentResult} className="text-4xl font-semibold tracking-tight" />
            ) : (
              '—'
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <PeriodReturn periodReturn={overview.periodReturn} />
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        </CardContent>
      </Card>
    </section>
  )
}

function PeriodReturn({ periodReturn }: { periodReturn: PortfolioOverviewView['periodReturn'] }) {
  if (periodReturn?.status === 'CALCULATED' && periodReturn.decimal) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">Rendimiento del período</p>
        <p className="text-sm font-medium tabular-nums" title={DIETZ_NOTE}>
          {formatReturnPercent(periodReturn.decimal)}
        </p>
        <p className="text-xs text-muted-foreground">{DIETZ_NOTE}</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">Rendimiento del período</p>
      <p className="text-sm font-medium tabular-nums">
        {periodReturn?.status === 'INVALID_WEIGHTED_CAPITAL' ? 'No disponible' : '—'}
      </p>
    </div>
  )
}
