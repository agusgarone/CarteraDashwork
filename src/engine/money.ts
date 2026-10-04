import Decimal from 'decimal.js'
import type { DecimalString } from '../domain/common'
import { AnalysisError } from './errors/analysisErrors'

/**
 * Normalización a dos decimales de snapshots, posiciones y flujos explícitos.
 * La caja y el tipo de cambio pueden necesitar más decimales: usan formatExact.
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

/**
 * Conserva los decimales que produjo el cálculo y completa hasta dos.
 * 8424.216 sigue siendo 8424.216; 10000 pasa a 10000.00.
 * No recorta a dos decimales un producto de tipo de cambio.
 */
export function formatExact(value: Decimal): DecimalString {
  const places = Math.max(value.decimalPlaces(), MONETARY_DECIMAL_PLACES)
  return value.toFixed(places)
}

export function normalizeMonetary(value: DecimalString): DecimalString {
  return formatMonetary(parseDecimal(value))
}

export function zeroDecimal(): Decimal {
  return new Decimal('0')
}
