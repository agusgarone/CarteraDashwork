import type { PendingExternalFlowFx } from '@/engine/calculations/externalFlowValuation'

export function ExternalFlowFxNotice({
  valuation,
}: {
  valuation: PendingExternalFlowFx
}) {
  return (
    <div role="status" className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
      <p>
        Datos importados. El resultado y el rendimiento están pendientes de la
        valuación en pesos de estos aportes o retiros.
      </p>
      <ul className="space-y-1 text-muted-foreground">
        {valuation.flows.map((flow) => (
          <li key={flow.transactionId}>
            {flow.date} · {flow.type === 'WITHDRAWAL' ? 'Retiro' : 'Aporte'} ·{' '}
            {flow.amount} {flow.currency.replace('_', ' ')} ·{' '}
            {flow.reference ?? 'Sin referencia'}
          </li>
        ))}
      </ul>
      <p>Falta una cotización documental asociada al movimiento.</p>
    </div>
  )
}
