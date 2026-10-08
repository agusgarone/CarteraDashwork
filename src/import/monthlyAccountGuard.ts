import type { ParsedMonthlyAccount } from '../parsers/models/parsedMonthlyAccount'
import { ImportPeriodParsingError } from './importPeriodErrors'

const CRITICAL_CODES = new Set(['MISSING_DATE', 'MISSING_AMOUNT'])

/**
 * Una fila financiera reconocida que pierde la fecha o el importe cambia
 * flujos externos, rendimiento y caja. No se deja pasar como período completo.
 */
export function assertMonthlyAccountReadable(parsed: ParsedMonthlyAccount): void {
  const unread = parsed.warnings.filter((warning) => CRITICAL_CODES.has(warning.code))
  if (unread.length === 0) return
  throw new ImportPeriodParsingError(unread.length)
}
