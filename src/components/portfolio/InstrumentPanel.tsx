import { useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SignedAmount } from '@/components/shared/SignedAmount'
import type { Instrument, InstrumentResultOrigin } from '@/types/portfolio'
import type { Transaction, TransactionType } from '@/types/transaction'
import { formatCurrency } from '@/utils/formatCurrency'
import { formatDate } from '@/utils/formatDate'

const quantityFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

const typeLabels: Record<TransactionType, string> = {
  buy: 'Compra',
  sell: 'Venta',
  dividend: 'Dividendo',
  interest: 'Interés',
  fee: 'Comisión',
  tax: 'Impuesto',
  contribution: 'Aporte',
  withdrawal: 'Retiro',
  corporate_action: 'Evento corporativo',
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums">{children}</p>
    </div>
  )
}

export function InstrumentPanel({
  instrument,
  origin,
  periodTransactions,
  allTransactions,
  onClose,
}: {
  instrument: Instrument
  origin: InstrumentResultOrigin
  periodTransactions: Transaction[]
  allTransactions: Transaction[]
  onClose: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const operations = showAll ? allTransactions : periodTransactions

  return (
    <aside className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{instrument.ticker}</h2>
          <p className="text-sm text-muted-foreground">{instrument.name}</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar instrumento">
          <X />
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <Fact label="Valor actual">{formatCurrency(instrument.currentValue)}</Fact>
        <Fact label="Cantidad">
          {quantityFormatter.format(instrument.quantity)} {instrument.quantityUnit}
        </Fact>
        <Fact label="Capital invertido">{formatCurrency(instrument.investedCapital)}</Fact>
        <Fact label="Resultado">
          <SignedAmount value={instrument.result} />
        </Fact>
        <Fact label="Rendimiento">
          <SignedAmount value={instrument.returnPercentage} format="percentage" />
        </Fact>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-medium">Origen del resultado</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Variación de mercado</dt>
            <dd>
              <SignedAmount value={origin.marketChange} />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Dividendos</dt>
            <dd>
              <SignedAmount value={origin.dividends} />
            </dd>
          </div>
          {origin.interest !== 0 && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Intereses / rentas</dt>
              <dd>
                <SignedAmount value={origin.interest} />
              </dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Costos e impuestos</dt>
            <dd>
              <SignedAmount value={-origin.feesAndTaxes} />
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-medium">{showAll ? 'Historial de operaciones' : 'Operaciones del período'}</h3>
        {operations.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No hubo operaciones en este período.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {operations.map((operation) => (
              <li key={operation.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{formatDate(operation.date)}</span>
                <span className="text-right">
                  {typeLabels[operation.type]}
                  {operation.quantity !== null && (
                    <>
                      {' '}
                      · {quantityFormatter.format(operation.quantity)} {instrument.quantityUnit}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {allTransactions.length > 0 && (
          <button
            type="button"
            className="mt-4 text-sm font-medium text-foreground underline-offset-4 hover:underline"
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? 'Ver solo el período' : 'Ver historial completo'}
          </button>
        )}
      </div>
    </aside>
  )
}
