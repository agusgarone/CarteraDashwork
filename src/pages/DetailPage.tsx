import { useState } from 'react'
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { visibleInstruments, type DetailSort } from '@/application/portfolioDetail'
import { usePortfolioDetail } from '@/application/usePortfolioDetail'
import { useImportDialog } from '@/components/import/ImportDialogProvider'
import { CategoryList } from '@/components/portfolio/CategoryList'
import { InstrumentPanel } from '@/components/portfolio/InstrumentPanel'
import { InstrumentTable } from '@/components/portfolio/InstrumentTable'
import { SignedDecimal } from '@/components/shared/SignedDecimal'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCurrencyARS } from '@/utils/formatCurrency'

export function DetailPage() {
  const { screen, retry } = usePortfolioDetail()
  const { setOpen } = useImportDialog()
  const [categoryId, setCategoryId] = useState('ALL')
  const [instrumentId, setInstrumentId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<DetailSort>('currentValue')
  const periodId = screen.status === 'ready' ? screen.view.period.id : null
  const [trackedPeriodId, setTrackedPeriodId] = useState(periodId)
  if (periodId !== trackedPeriodId) {
    setTrackedPeriodId(periodId)
    setCategoryId('ALL')
    setInstrumentId(null)
    setQuery('')
  }

  if (screen.status === 'loading') return <DetailSkeleton />
  if (screen.status === 'error') {
    return (
      <ScreenMessage
        title="No se pudo mostrar el detalle"
        body={screen.message}
        action={<Button type="button" onClick={retry}>Reintentar</Button>}
      />
    )
  }
  if (screen.status === 'empty') {
    return (
      <ScreenMessage
        title="Aún no hay períodos importados."
        body="Cuando importes un mes completo, el detalle va a leer esas posiciones."
        action={<Button type="button" onClick={() => setOpen(true)}>Importar mes</Button>}
      />
    )
  }

  const view = screen.view
  const selectedCategory = view.categories.find((category) => category.id === categoryId) ?? null
  const rows = visibleInstruments(view.instruments, { categoryId, query, sort: sortKey })
  const selected = view.instruments.find((instrument) => instrument.id === instrumentId) ?? null
  const title = categoryId === 'ALL' ? 'Inversiones' : (selectedCategory?.label ?? 'Inversiones')

  const categories = [
    {
      id: 'ALL',
      label: 'Todas',
      closingValue: view.totals.investmentValue,
      valuationChange: view.totals.valuationChange,
    },
    ...view.categories.map((category) => ({
      id: category.id,
      label: category.label,
      closingValue: category.closingValue,
      valuationChange: category.valuationChange,
    })),
  ]

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_300px]">
      <CategoryList
        categories={categories}
        selectedId={categoryId}
        onSelect={(nextId) => {
          setCategoryId(nextId)
          setInstrumentId(null)
        }}
      />

      <section className="min-w-0 space-y-4">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{view.period.label}</p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {categoryId === 'ALL' ? (
            <>
              <Metric label="Valor de inversiones" value={money(view.totals.investmentValue)} />
              <Metric label="Patrimonio total" value={formatCurrencyARS(view.totals.portfolioValue)} />
              <Metric label="Variación de valuación" value={signed(view.totals.valuationChange)} />
              <Metric label="Posiciones" value={String(view.instruments.length)} />
            </>
          ) : (
            <>
              <Metric label="Valor de cierre" value={money(selectedCategory?.closingValue ?? null)} />
              <Metric label="Valor de apertura" value={money(selectedCategory?.openingValue ?? null)} />
              <Metric label="Variación de valuación" value={signed(selectedCategory?.valuationChange ?? null)} />
              <Metric label="Posiciones" value={String(selectedCategory?.positionCount ?? 0)} />
            </>
          )}
        </div>
        {categoryId === 'ALL' ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            El patrimonio total incluye la liquidez. Esta pantalla lista las inversiones.
          </p>
        ) : null}

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
                <Select value={sortKey} onValueChange={(value) => setSortKey(value as DetailSort)}>
                  <SelectTrigger className="w-[200px]" aria-label="Ordenar por">
                    <SelectValue placeholder="Ordenar por" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="currentValue">Mayor valor actual</SelectItem>
                    <SelectItem value="valuationChange">Mayor variación</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <InstrumentTable instruments={rows} selectedId={instrumentId} onSelect={setInstrumentId} />
          </CardContent>
        </Card>
      </section>

      <div className="min-w-0 lg:col-start-2 xl:col-start-auto">
        {selected ? (
          <InstrumentPanel key={selected.id} instrument={selected} onClose={() => setInstrumentId(null)} />
        ) : (
          <aside className="rounded-xl bg-card p-5 text-sm text-muted-foreground ring-1 ring-foreground/10">
            <p className="font-medium text-foreground">Instrumento</p>
            <p className="mt-2 leading-relaxed">
              Seleccioná una fila para ver de dónde sale su variación, sin salir de esta pantalla.
            </p>
          </aside>
        )}
      </div>
    </div>
  )
}

function money(value: string | null) {
  return value ? formatCurrencyARS(value) : '—'
}

function signed(value: string | null) {
  return value ? <SignedDecimal value={value} className="text-xl font-semibold tracking-tight" /> : '—'
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  )
}

function ScreenMessage({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4 py-8">
        <p className="text-base font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
        {action}
      </CardContent>
    </Card>
  )
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)]" aria-busy="true" aria-live="polite">
      <div className="h-80 animate-pulse rounded-xl bg-muted" />
      <div className="h-80 animate-pulse rounded-xl bg-muted" />
    </div>
  )
}
