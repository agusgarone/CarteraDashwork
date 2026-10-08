import type { ReconciliationStatus } from '../domain/reconciliation'
import { formatCurrencyARS } from '../utils/formatCurrency'

export const CASH_LEDGER_RECONCILED_NOTE =
  'Caja reconciliada. La atribución de operaciones del período todavía está pendiente.'

export const PARTIAL_ATTRIBUTION_NOTE = 'Atribución parcial del resultado'

/** WARNING no es un rendimiento negativo ni un fallo de importación. */
export function reconciliationNote(
  status: ReconciliationStatus | null,
  difference: string | null,
  attribution: 'AVAILABLE' | 'PENDING' | null = null,
  positionAttribution: 'PARTIAL' | null = null,
): string | null {
  if (positionAttribution === 'PARTIAL' && status === null) return PARTIAL_ATTRIBUTION_NOTE
  if (attribution === 'PENDING' && status === null) return CASH_LEDGER_RECONCILED_NOTE
  if (status === 'RECONCILED') return null
  if (status === 'WARNING' && difference !== null) {
    return `Diferencia pendiente: ${formatCurrencyARS(difference)}`
  }
  if (status === 'FAILED') {
    return 'Los datos se importaron correctamente. Este período contiene operaciones que todavía no pueden reconciliarse automáticamente.'
  }
  return 'Datos importados. Análisis pendiente.'
}
