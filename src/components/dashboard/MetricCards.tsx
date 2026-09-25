import { cn } from 'cn'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SignedAmount } from '@/components/shared/SignedAmount'
import { formatCurrency } from '@/utils/formatCurrency'
import { toneClass } from '@/utils/tone'

interface MetricCardsProps {
  patrimony: number
  patrimonyChange: number
  investedCapital: number
  netContributions: number
  investmentResult: number
  returnPercentage: number
}

export function MetricCards({
  patrimony,
  patrimonyChange,
  investedCapital,
  netContributions,
  investmentResult,
  returnPercentage,
}: MetricCardsProps) {
  const positive = investmentResult >= 0

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">Patrimonio actual</p>
          <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatCurrency(patrimony)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <SignedAmount value={patrimonyChange} />
            <span className="text-muted-foreground"> en período</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">Capital neto aportado</p>
          <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
            {formatCurrency(investedCapital)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <SignedAmount value={netContributions} />
            <span className="text-muted-foreground"> en período</span>
          </p>
        </CardContent>
      </Card>

      <Card className={cn(positive ? 'bg-positive/5 ring-positive/20' : 'bg-negative/5 ring-negative/20')}>
        <CardHeader>
          <p className={cn('text-sm font-medium', positive ? 'text-positive' : 'text-negative')}>
            Generado por inversiones
          </p>
          <CardTitle className={cn('text-4xl font-semibold tracking-tight', toneClass(investmentResult))}>
            <SignedAmount value={investmentResult} className="text-4xl font-semibold tracking-tight" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <SignedAmount value={returnPercentage} format="percentage" />
            <span className="text-muted-foreground"> en período</span>
          </p>
        </CardContent>
      </Card>
    </section>
  )
}
