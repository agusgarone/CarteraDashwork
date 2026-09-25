import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SignedAmount } from '@/components/shared/SignedAmount'
import type { PortfolioPeriodSummary } from '@/types/portfolio'
import { formatCurrency } from '@/utils/formatCurrency'

function Row({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={emphasize ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span className={emphasize ? 'font-medium tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  )
}

export function PeriodSummaryCard({
  periodLabel,
  summary,
  missingLabels,
}: {
  periodLabel: string
  summary: PortfolioPeriodSummary
  missingLabels: string[]
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Resumen del período</CardTitle>
        <p className="text-xs text-muted-foreground">{periodLabel}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <Row label="Inicio del período" value={formatCurrency(summary.startValue)} />
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-muted-foreground">Aportes</span>
          <SignedAmount value={summary.contributions} />
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-muted-foreground">Retiros</span>
          <SignedAmount value={-summary.withdrawals} />
        </div>
        <div className="my-1 border-t border-border" />
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-medium">Aporte neto</span>
          <SignedAmount value={summary.netContributions} className="font-medium" />
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-medium">Generado por inversiones</span>
          <SignedAmount value={summary.investmentResult} className="font-medium" />
        </div>
        {summary.unexplainedDifference !== 0 && (
          <div className="flex items-baseline justify-between gap-4 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
            <span>Diferencia sin explicar</span>
            <span className="tabular-nums">{formatCurrency(summary.unexplainedDifference, { signed: true })}</span>
          </div>
        )}
        <div className="my-1 border-t border-border" />
        <Row label="Final del período" value={formatCurrency(summary.endValue)} emphasize />
        {missingLabels.length > 0 && (
          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
            {missingLabels.join(', ')} no tiene datos cargados. Esos meses no entran en los totales.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
