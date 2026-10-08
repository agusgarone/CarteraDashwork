import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SignedDecimal } from '@/components/shared/SignedDecimal'
import type { CurrencyCode } from '@/domain/currency'
import type { InstrumentDetail } from '@/application/portfolioDetail'
import { formatCurrencyARS, formatDecimal, formatQuantity } from '@/utils/formatCurrency'
import { formatDate } from '@/utils/formatDate'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums">{children}</p>
    </div>
  )
}

const CURRENCY_LABEL: Record<CurrencyCode, string> = {
  ARS: 'ARS',
  USD_MEP: 'USD MEP',
  USD_CABLE: 'USD Cable',
}

export function InstrumentPanel({
  instrument,
  onClose,
}: {
  instrument: InstrumentDetail
  onClose: () => void
}) {
  return (
    <aside className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{instrument.ticker}</h2>
          <p className="text-sm text-muted-foreground">{instrument.name ?? instrument.categoryLabel}</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar instrumento">
          <X />
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <Fact label="Valor actual">{instrument.currentValue ? formatCurrencyARS(instrument.currentValue) : '—'}</Fact>
        <Fact label="Cantidad">{instrument.quantity ? formatQuantity(instrument.quantity) : '—'}</Fact>
        <Fact label="Valor de apertura">
          {instrument.openingValue ? formatCurrencyARS(instrument.openingValue) : '—'}
        </Fact>
        <Fact label="Variación de valuación">
          {instrument.valuationChange ? <SignedDecimal value={instrument.valuationChange} /> : '—'}
        </Fact>
        {instrument.boughtQuantity !== null ? (
          <>
            <Fact label="Cantidad de apertura">{formatQuantity(instrument.openingQuantity ?? '0')}</Fact>
            <Fact label="Compras">{formatQuantity(instrument.boughtQuantity ?? '0')}</Fact>
            <Fact label="Ventas">{formatQuantity(instrument.soldQuantity ?? '0')}</Fact>
            <Fact label="Suscripciones">{formatQuantity(instrument.subscribedQuantity ?? '0')}</Fact>
            <Fact label="Conciliación">{instrument.quantityStatusLabel ?? '—'}</Fact>
            {instrument.flowNote ? null : (
              <>
                <Fact label="Compras y suscripciones">
                  {instrument.acquisitionFlows ? formatCurrencyARS(instrument.acquisitionFlows) : '—'}
                </Fact>
                <Fact label="Ventas y rescates">
                  {instrument.disposalFlows ? formatCurrencyARS(instrument.disposalFlows) : '—'}
                </Fact>
              </>
            )}
          </>
        ) : instrument.openingQuantityDiffers && instrument.openingQuantity ? (
          <Fact label="Cantidad al inicio">{formatQuantity(instrument.openingQuantity)}</Fact>
        ) : null}
        <Fact label="Estado">{instrument.statusLabel ?? '—'}</Fact>
      </div>
      {instrument.flowNote ? <p className="mt-3 text-sm text-muted-foreground">{instrument.flowNote}</p> : null}

      {instrument.provenance.length > 0 ? (
        <ul className="mt-5 space-y-1 text-sm text-muted-foreground">
          {instrument.provenance.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-medium">Acciones corporativas</h3>
        {instrument.corporateActions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No hay acciones corporativas en este período.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {instrument.corporateActions.map((action) => (
              <li key={action.id} className="text-sm">
                <p className="font-medium">{action.typeLabel}</p>
                <p className="mt-1 text-muted-foreground">
                  {formatDate(action.date)}
                  {action.quantityBefore && action.quantityAfter
                    ? ` · ${formatQuantity(action.quantityBefore)} → ${formatQuantity(action.quantityAfter)}`
                    : ''}
                  {action.quantityChange ? ` · ${formatSignedQuantity(action.quantityChange)} acciones` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-medium">Movimientos del período</h3>
        {instrument.movements.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No hay movimientos de este instrumento en el período.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {instrument.movements.map((movement) => (
              <li key={movement.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{formatDate(movement.date)}</span>
                <span className="text-right">
                  {movement.typeLabel}
                  {movement.quantity ? ` · ${formatQuantity(movement.quantity)}` : ''}
                  {movement.netAmount ? ` · ${formatDecimal(movement.netAmount)} ${CURRENCY_LABEL[movement.currency]}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

function formatSignedQuantity(value: string): string {
  const formatted = formatQuantity(value)
  if (formatted.startsWith('-') || !/[1-9]/.test(formatted)) return formatted
  return `+${formatted}`
}
