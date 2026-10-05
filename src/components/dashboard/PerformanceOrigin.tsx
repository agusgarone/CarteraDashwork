import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SignedDecimal } from '@/components/shared/SignedDecimal'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { PortfolioOverviewView } from '@/application/portfolioOverview'

export function PerformanceOrigin({ overview }: { overview: PortfolioOverviewView }) {
  const breakdown = overview.resultBreakdown
  const pending = overview.metrics.unexplainedDifference

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">¿De dónde vino el resultado?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Variación de posiciones, resultado de caja y lo que todavía queda pendiente.
          </p>
        </div>
        <Button variant="ghost" asChild>
          <Link to="/detalle">
            Ver detalle completo
            <ArrowRight />
          </Link>
        </Button>
      </div>
      {breakdown ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">Variación de posiciones</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                <SignedDecimal value={breakdown.positionValuation} className="text-2xl font-semibold tracking-tight" />
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">Resultado de caja</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                <SignedDecimal value={breakdown.cashEconomicResult} className="text-2xl font-semibold tracking-tight" />
              </p>
              {breakdown.cash ? (
                <ul className="mt-4 space-y-1.5 text-sm">
                  <CashLine label="Tipo de cambio" value={breakdown.cash.fxValuationChange} />
                  <CashLine label="Dividendos" value={breakdown.cash.dividends} />
                  <CashLine label="Intereses" value={breakdown.cash.interest} />
                  <CashLine label="Comisiones" value={signedCost(breakdown.cash.fees)} />
                  <CashLine label="Impuestos" value={signedCost(breakdown.cash.taxes)} />
                  <CashLine label="Otros" value={breakdown.cash.otherCashResult} />
                </ul>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">Pendiente de reconciliación</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {pending ? (
                  <SignedDecimal value={pending} className="text-2xl font-semibold tracking-tight" />
                ) : (
                  '—'
                )}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Datos importados. Análisis pendiente.</p>
      )}
    </section>
  )
}

function CashLine({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <SignedDecimal value={value} />
    </li>
  )
}

function signedCost(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('-') || !/[1-9]/.test(trimmed)) return trimmed
  return `-${trimmed}`
}
