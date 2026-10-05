import { cn } from 'cn'
import { SignedDecimal } from '@/components/shared/SignedDecimal'
import { formatCurrencyARS } from '@/utils/formatCurrency'

export interface CategoryRow {
  id: string
  label: string
  closingValue: string | null
  valuationChange: string | null
}

export function CategoryList({
  categories,
  selectedId,
  onSelect,
}: {
  categories: CategoryRow[]
  selectedId: string
  onSelect: (categoryId: string) => void
}) {
  return (
    <div className="rounded-xl bg-card p-2 ring-1 ring-foreground/10">
      <p className="px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Categorías
      </p>
      <ul className="space-y-0.5">
        {categories.map((category) => {
          const active = category.id === selectedId
          return (
            <li key={category.id}>
              <button
                type="button"
                onClick={() => onSelect(category.id)}
                className={cn(
                  'w-full rounded-lg px-3 py-3 text-left transition-colors',
                  active ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span className="block text-sm font-medium">{category.label}</span>
                <span className="mt-1 block text-sm tabular-nums">
                  {category.closingValue ? formatCurrencyARS(category.closingValue) : '—'}
                </span>
                <span className="mt-0.5 block text-xs">
                  {category.valuationChange ? <SignedDecimal value={category.valuationChange} className="text-xs" /> : '—'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
