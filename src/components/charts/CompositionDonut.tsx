import { Cell, Pie, PieChart, Tooltip } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { AllocationItem } from '@/application/portfolioOverview'
import { formatCurrencyARS } from '@/utils/formatCurrency'
import Decimal from 'decimal.js'
import { formatShare } from '@/utils/formatPercentage'

const COLORS: Record<string, string> = {
  CEDEAR: '#7C93B0',
  CORPORATE_BOND: '#C4A574',
  BOND: '#C4A574',
  FUND: '#6E9E93',
  STOCK: '#A98BB8',
  CASH: '#C5C8CE',
  OTHER: '#C5C8CE',
}

function colorOf(id: string) {
  return COLORS[id] ?? '#C5C8CE'
}

function DonutTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const item = payload[0]?.payload as (AllocationItem & { chartValue: number }) | undefined
  if (!item) return null
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-sm ring-1 ring-foreground/10">
      <p className="font-medium">{item.label}</p>
      <p className="mt-1 tabular-nums text-muted-foreground">
        {formatShare(item.weight)} · {formatCurrencyARS(item.marketValue)}
      </p>
    </div>
  )
}

export function CompositionDonut({
  allocation,
  residual,
}: {
  allocation: AllocationItem[]
  residual: string
}) {
  const data = allocation.map((item) => ({
    ...item,
    chartValue: new Decimal(item.marketValue).toNumber(),
  }))
  const residualVisible = /[1-9]/.test(residual)

  return (
    <div className="space-y-4">
      <div className="grid items-center gap-6 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div className="mx-auto">
          <PieChart width={220} height={220}>
            <Pie
              data={data}
              dataKey="chartValue"
              nameKey="label"
              cx={110}
              cy={110}
              innerRadius={64}
              outerRadius={96}
              paddingAngle={1.5}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((item) => (
                <Cell key={item.id} fill={colorOf(item.id)} />
              ))}
            </Pie>
            <Tooltip content={DonutTooltip} />
          </PieChart>
        </div>
        <ul className="space-y-3">
          {allocation.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-4">
              <span className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(item.id) }} />
                {item.label}
              </span>
              <span className="text-right">
                <span className="block text-sm font-medium tabular-nums">{formatShare(item.weight)}</span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {formatCurrencyARS(item.marketValue)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {residualVisible ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          La suma de las tenencias no coincide exactamente con el patrimonio informado. Diferencia:{' '}
          {formatCurrencyARS(residual)}.
        </p>
      ) : null}
    </div>
  )
}
