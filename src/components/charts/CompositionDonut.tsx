import { Cell, Pie, PieChart, Tooltip } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { getCategoryColor } from '@/services/portfolioService'
import type { Category } from '@/types/portfolio'
import { formatCurrency } from '@/utils/formatCurrency'
import { formatWeight } from '@/utils/formatPercentage'

function DonutTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const category = payload[0]?.payload as Category | undefined
  if (!category) return null
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-sm ring-1 ring-foreground/10">
      <p className="font-medium">{category.name}</p>
      <p className="mt-1 tabular-nums text-muted-foreground">
        {formatWeight(category.weight)} · {formatCurrency(category.currentValue)}
      </p>
    </div>
  )
}

export function CompositionDonut({ categories }: { categories: Category[] }) {
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[220px_minmax(0,1fr)]">
      <div className="mx-auto">
        <PieChart width={220} height={220}>
          <Pie
            data={categories}
            dataKey="currentValue"
            nameKey="name"
            cx={110}
            cy={110}
            innerRadius={64}
            outerRadius={96}
            paddingAngle={1.5}
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {categories.map((category) => (
              <Cell key={category.id} fill={getCategoryColor(category.id)} />
            ))}
          </Pie>
          <Tooltip content={DonutTooltip} />
        </PieChart>
      </div>
      <ul className="space-y-3">
        {categories.map((category) => (
          <li key={category.id} className="flex items-start justify-between gap-4">
            <span className="flex items-center gap-2 text-sm">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: getCategoryColor(category.id) }}
              />
              {category.name}
            </span>
            <span className="text-right">
              <span className="block text-sm font-medium tabular-nums">{formatWeight(category.weight)}</span>
              <span className="block text-xs tabular-nums text-muted-foreground">
                {formatCurrency(category.currentValue)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
