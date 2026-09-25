import { cn } from 'cn'
import { SignedAmount } from '@/components/shared/SignedAmount'
import type { Category } from '@/types/portfolio'
import { formatCurrency } from '@/utils/formatCurrency'

export function CategoryList({
  categories,
  selectedId,
  onSelect,
}: {
  categories: Category[]
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
                <span className="block text-sm font-medium">{category.name}</span>
                <span className="mt-1 block text-sm tabular-nums">{formatCurrency(category.currentValue)}</span>
                <span className="mt-0.5 block text-xs">
                  <SignedAmount value={category.periodResult} className="text-xs" />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
