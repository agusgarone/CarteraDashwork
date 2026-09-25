import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'
import type { EvolutionPoint } from '@/types/portfolio'

function formatAxis(value: number) {
  const millions = value / 1_000_000
  return `$${millions.toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`
}

function EvolutionTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload as EvolutionPoint | undefined
  if (!point) return null

  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-sm ring-1 ring-foreground/10">
      <p className="mb-1.5 font-medium text-foreground">{label}</p>
      {point.totalValue === null ? (
        <p className="text-muted-foreground">Sin datos</p>
      ) : (
        <div className="space-y-1">
          <p className="flex items-center justify-between gap-6">
            <span className="text-muted-foreground">Patrimonio</span>
            <span className="tabular-nums">{formatCurrency(point.totalValue)}</span>
          </p>
          <p className="flex items-center justify-between gap-6">
            <span className="text-muted-foreground">Capital aportado</span>
            <span className="tabular-nums">
              {point.investedCapital === null ? '—' : formatCurrency(point.investedCapital)}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

export function PortfolioEvolutionChart({ points }: { points: EvolutionPoint[] }) {
  return (
    <div className="h-[340px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
            dataKey="totalValue"
            name="Patrimonio total"
            stroke="#1f2933"
            strokeWidth={2.25}
            dot={{ r: 3, strokeWidth: 0, fill: '#1f2933' }}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="investedCapital"
            name="Capital aportado"
            stroke="#9aa3af"
            strokeWidth={1.75}
            strokeDasharray="4 4"
            dot={{ r: 2.5, strokeWidth: 0, fill: '#9aa3af' }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
