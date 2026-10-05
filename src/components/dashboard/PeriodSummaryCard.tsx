import { Check } from 'lucide-react'
import { SignedDecimal } from '@/components/shared/SignedDecimal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { reconciliationNote } from '@/application/overviewCopy'
import type { PortfolioOverviewView } from '@/application/portfolioOverview'
import { formatCurrencyARS } from '@/utils/formatCurrency'

function Row({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={emphasize ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span className={emphasize ? 'font-medium tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  )
}

export function PeriodSummaryCard({ overview }: { overview: PortfolioOverviewView }) {
  const { metrics, importStatus } = overview
  const note = reconciliationNote(importStatus.reconciliationStatus, importStatus.unexplainedDifference)

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Resumen del período</CardTitle>
        <p className="text-xs text-muted-foreground">{overview.period.label}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <Row
          label="Inicio del período"
          value={metrics.openingPortfolioValue ? formatCurrencyARS(metrics.openingPortfolioValue) : '—'}
        />
        <Flow label="Aportes" value={metrics.contributions} />
        <Flow label="Retiros" value={metrics.withdrawals ? negate(metrics.withdrawals) : null} />
        <div className="my-1 border-t border-border" />
        <Flow label="Aporte neto" value={metrics.netContributions} emphasize />
        <Flow label="Generado por inversiones" value={metrics.investmentResult} emphasize />
        <div className="my-1 border-t border-border" />
        <Row label="Final del período" value={formatCurrencyARS(metrics.currentPortfolioValue)} emphasize />
        {note ? <p className="text-xs leading-relaxed text-muted-foreground">{note}</p> : null}
        <ul className="space-y-1.5 pt-1">
          {importStatus.documents.map((document) => (
            <li key={document.id} className="flex items-center gap-2 text-xs">
              <Check className={document.present ? 'size-3.5 text-positive' : 'size-3.5 text-muted-foreground'} />
              <span className={document.present ? '' : 'text-muted-foreground'}>
                {document.present ? document.label : `${document.label} — no importado`}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function Flow({ label, value, emphasize = false }: { label: string; value: string | null; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={emphasize ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      {value ? <SignedDecimal value={value} className={emphasize ? 'font-medium' : undefined} /> : <span>—</span>}
    </div>
  )
}

function negate(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('-')) return trimmed.slice(1)
  if (!/[1-9]/.test(trimmed)) return trimmed
  return `-${trimmed}`
}
