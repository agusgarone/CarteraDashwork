import { Card, CardContent } from '@/components/ui/card'
import { formatCurrencyARS } from '@/utils/formatCurrency'
import { summarizePlan, type SalaryPlan } from './model'

export function SalarySummary({ plan }: { plan: SalaryPlan }) {
  const summary = summarizePlan(plan)
  if (summary.status === 'MISSING_FX')
    return (
      <p role="alert" className="rounded-lg bg-muted p-4 text-sm">
        Completá la cotización USD del presupuesto para calcular los importes de
        este mes.
      </p>
    )
  const items = [
    ['Ingresos netos', summary.netIncome],
    ['Tarjetas y cuotas', summary.card],
    ['Gastos fijos', summary.fixed],
    ['Reservas', summary.reserves],
    ['Para gastar en el mes', summary.livingAllowance],
    ['Ahorro previsto', summary.savings],
  ]
  return (
    <section
      aria-label="Resumen del sueldo"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {items.map(([label, value]) => (
        <Card key={label}>
          <CardContent className="space-y-2 py-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p
              className={`text-2xl font-semibold tabular-nums ${value!.startsWith('-') ? 'text-negative' : ''}`}
            >
              {formatCurrencyARS(value!)}
            </p>
          </CardContent>
        </Card>
      ))}
      <p className="text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
        Pendiente de pagar o separar{' '}
        <strong className="text-foreground">
          {formatCurrencyARS(summary.pending)}
        </strong>
        . Los compromisos completos se descuentan del presupuesto del mes.
      </p>
    </section>
  )
}
