import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SignedAmount } from '@/components/shared/SignedAmount'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { PerformanceBreakdown } from '@/types/portfolio'

export function PerformanceOrigin({ breakdown }: { breakdown: PerformanceBreakdown }) {
  const items = [
    { label: 'Mercado', value: breakdown.marketChange },
    { label: 'Dividendos', value: breakdown.dividends },
    { label: 'Intereses / rentas', value: breakdown.interest },
    { label: 'Costos e impuestos', value: -(breakdown.fees + breakdown.taxes) },
  ]

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">¿De dónde vino el resultado?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Variación de mercado, ingresos y costos que componen lo generado por las inversiones.
          </p>
        </div>
        <Button variant="ghost" asChild>
          <Link to="/detalle">
            Ver detalle completo
            <ArrowRight />
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <Card key={item.label}>
            <CardContent>
              <p className="text-sm text-muted-foreground">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                <SignedAmount value={item.value} className="text-2xl font-semibold tracking-tight" />
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
