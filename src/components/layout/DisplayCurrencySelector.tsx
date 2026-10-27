import { useDisplayCurrency } from '@/presentation/DisplayCurrencyProvider'
import { displayReferenceLegend } from '@/presentation/displayMoney'

export function DisplayCurrencySelector() {
  const display = useDisplayCurrency()
  return (
    <div role="group" aria-label="Moneda de visualización" className="flex rounded-md border border-border p-0.5 text-xs">
      {(['ARS', 'USD'] as const).map(currency => (
        <button key={currency} type="button" aria-pressed={display.currency === currency}
          disabled={currency === 'USD' && !display.usdAvailable}
          title={currency === 'USD' && !display.usdAvailable ? display.loading ? 'Consultando cotización MEP de cierre…' : display.message ?? 'USD no disponible para este período.' : `Mostrar importes en ${currency}`}
          onClick={() => display.setCurrency(currency)}
          className={`rounded px-2.5 py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${display.currency === currency ? 'bg-muted font-semibold' : 'text-muted-foreground'}`}>
          {currency}
        </button>
      ))}
    </div>
  )
}

export function DisplayCurrencyReference() {
  const display = useDisplayCurrency()
  if (display.currency === 'USD' && display.referenceFx) {
    return <p className="mb-4 text-xs text-muted-foreground" title={`Fuente: Posición consolidada Balanz · ${display.referenceFx.source.originalFilename}`}>
      {displayReferenceLegend(display.referenceFx)}
    </p>
  }
  if (display.message) return <p role="status" className="mb-4 text-xs text-muted-foreground">{display.message}</p>
  if (display.requestedCurrency === 'USD' && display.loading) return <p role="status" className="mb-4 text-xs text-muted-foreground">Consultando cotización MEP del período…</p>
  return null
}