import type { ReconciliationStatus } from '../domain/reconciliation'
import { formatCurrencyARS } from '../utils/formatCurrency'

/** WARNING no es un rendimiento negativo ni un fallo de importación. */
export function reconciliationNote(
  status: ReconciliationStatus | null,
  difference: string | null,
): string | null {
  if (status === 'RECONCILED') return null
  if (status === 'WARNING' && difference !== null) {
    return `Diferencia pendiente: ${formatCurrencyARS(difference)}`
  }
  if (status === 'FAILED') {
    return 'Los datos del período están importados. El análisis no se pudo reconciliar.'
  }
  return 'Datos importados. Análisis pendiente.'
}
