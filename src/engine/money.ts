import Decimal from 'decimal.js'
import type { DecimalString } from '../domain/common'
import { AnalysisError } from './errors/analysisErrors'

/**
 * Salida monetaria del engine: dos decimales.
 * No aplica a cantidades de instrumentos ni cuotapartes, que pueden tener más.
 * DecimalString sigue siendo string, sin escala fija.
 */
const MONETARY_DECIMAL_PLACES = 2

export function parseDecimal(value: DecimalString): Decimal {
  let decimal: Decimal
  try {
    decimal = new Decimal(value)
  } catch (cause) {
    throw new AnalysisError(`Importe monetario no válido: ${value}`, { cause })
  }
  if (!decimal.isFinite()) {
    throw new AnalysisError(`Importe monetario no válido: ${value}`)
  }
  return decimal
}

export function formatMonetary(value: Decimal): DecimalString {
  return value.toFixed(MONETARY_DECIMAL_PLACES)
}

export function normalizeMonetary(value: DecimalString): DecimalString {
  return formatMonetary(parseDecimal(value))
}

export function zeroDecimal(): Decimal {
  return new Decimal('0')
}
