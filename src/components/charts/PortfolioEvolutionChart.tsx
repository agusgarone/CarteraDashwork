import Decimal from 'decimal.js'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { formatCurrencyARS } from '@/utils/formatCurrency'
import type { PortfolioEvolutionPoint } from '@/application/portfolioOverview'

function formatAxis(value: number) {
  const millions = value / 1_000_000
  return `$${millions.toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`
}

function EvolutionTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload as { label: string; portfolioValue: string } | undefined
  if (!point) return null

  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-sm ring-1 ring-foreground/10">
      <p className="mb-1.5 font-medium text-foreground">{label}</p>
      <p className="flex items-center justify-between gap-6">
        <span className="text-muted-foreground">Patrimonio</span>
        <span className="tabular-nums">{formatCurrencyARS(point.portfolioValue)}</span>
      </p>
    </div>
  )
}

export function PortfolioEvolutionChart({ points }: { points: PortfolioEvolutionPoint[] }) {
  const data = points.map((point) => ({
    ...point,
    chartValue: new Decimal(point.portfolioValue).toNumber(),
  }))

  return (
    <div className="h-[340px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="oklch(0.93 0 0)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'oklch(0.55 0 0)', fontSize: 12 }}
            dy={8}
          />
          <YAxis
            tickFormatter={formatAxis}
            tickLine={false}
            axisLine={false}
            width={72}
            tick={{ fill: 'oklch(0.55 0 0)', fontSize: 12 }}
            domain={['auto', 'auto']}
          />
          <Tooltip content={EvolutionTooltip} />
          <Line
            type="monotone"
            dataKey="chartValue"
            name="Patrimonio total"
            stroke="#1f2933"
            strokeWidth={2.25}
            dot={{ r: 3, strokeWidth: 0, fill: '#1f2933' }}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
