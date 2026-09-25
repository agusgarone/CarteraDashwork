import { useState } from 'react'
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { CategoryList } from '@/components/portfolio/CategoryList'
import { InstrumentPanel } from '@/components/portfolio/InstrumentPanel'
import { InstrumentTable } from '@/components/portfolio/InstrumentTable'
import { usePeriod } from '@/components/period/PeriodProvider'
import { SignedAmount } from '@/components/shared/SignedAmount'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getCategories, getCategoryDetail, getInstrumentDetail } from '@/services/portfolioService'
import { formatCurrency } from '@/utils/formatCurrency'

type SortKey = 'position' | 'result' | 'return'

export function DetailPage() {
  const { selection } = usePeriod()
  const categories = getCategories(selection)
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 'cedears')
  const [instrumentId, setInstrumentId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('position')

  const detail = getCategoryDetail(categoryId, selection)
  const category = detail.category
  const instrument = instrumentId ? getInstrumentDetail(instrumentId, selection) : null
  const normalizedQuery = query.trim().toLowerCase()
  const instruments = detail.instruments
    .filter((item) => {
      if (!normalizedQuery) return true
      return (
        item.ticker.toLowerCase().includes(normalizedQuery) ||
        item.name.toLowerCase().includes(normalizedQuery)
      )
    })
    .sort((a, b) => {
      if (sortKey === 'result') return b.result - a.result
      if (sortKey === 'return') return b.returnPercentage - a.returnPercentage
      return b.currentValue - a.currentValue
    })

  function selectCategory(nextId: string) {
    setCategoryId(nextId)
    setInstrumentId(null)
    setQuery('')
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_300px]">
      <CategoryList categories={categories} selectedId={categoryId} onSelect={selectCategory} />

      <section className="min-w-0 space-y-4">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{category?.name}</h1>
        </header>
        {category && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Total actual" value={formatCurrency(category.currentValue)} />
            <Metric label="Capital invertido" value={formatCurrency(category.investedCapital)} />
            <Metric
              label="Resultado"
              value={<SignedAmount value={category.result} className="text-xl font-semibold tracking-tight" />}
            />
            <Metric
              label="Rendimiento"
              value={
                <SignedAmount
                  value={category.returnPercentage}
                  format="percentage"
                  className="text-xl font-semibold tracking-tight"
                />
              }
            />
          </div>
        )}

        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Instrumentos</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar instrumento..."
                    className="w-56 pl-8"
                  />
                </div>
                <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                  <SelectTrigger className="w-[180px]" aria-label="Ordenar por">
                    <SelectValue placeholder="Ordenar por" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="position">Mayor posición</SelectItem>
                    <SelectItem value="result">Mayor resultado</SelectItem>
                    <SelectItem value="return">Mayor rendimiento</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <InstrumentTable
              instruments={instruments}
              selectedId={instrumentId}
              onSelect={setInstrumentId}
            />
          </CardContent>
        </Card>
      </section>

      <div className="min-w-0 lg:col-start-2 xl:col-start-auto">
        {instrument ? (
          <InstrumentPanel
            key={instrument.instrument.id}
            instrument={instrument.instrument}
            origin={instrument.origin}
            periodTransactions={instrument.periodTransactions}
            allTransactions={instrument.allTransactions}
            onClose={() => setInstrumentId(null)}
          />
        ) : (
          <aside className="rounded-xl bg-card p-5 text-sm text-muted-foreground ring-1 ring-foreground/10">
            <p className="font-medium text-foreground">Instrumento</p>
            <p className="mt-2 leading-relaxed">
              Seleccioná una fila para ver de dónde sale su resultado, sin salir de esta pantalla.
            </p>
          </aside>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  )
}
