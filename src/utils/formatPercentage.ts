import Decimal from 'decimal.js'
import { formatDecimal } from './formatCurrency'

const percentageFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const weightFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/**
 * Ratio ya calculado, por ejemplo 0.006749… → +0,67%.
 * El ×100 y los dos decimales son solo de pantalla.
 */
export function formatReturnPercent(returnDecimal: string): string {
  const percent = new Decimal(returnDecimal).times(100)
  const body = formatDecimal(percent.abs().toFixed(2), 2)
  if (percent.isZero()) return `${body}%`
  return `${percent.isNegative() ? '-' : '+'}${body}%`
}

/** Ratio 0.0069 → +0,69% */
export function formatPercentage(value: number, options?: { signed?: boolean }) {
  const signed = options?.signed ?? true
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : ''
  return `${sign}${percentageFormatter.format(Math.abs(value * 100))}%`
}

/** Ratio 0.446 → 44,6% */
export function formatWeight(value: number) {
  return `${weightFormatter.format(value * 100)}%`
}

/** Participación guardada como ratio decimal, por ejemplo 0.446012 → 44,6%. */
export function formatShare(ratio: string): string {
  return `${formatDecimal(new Decimal(ratio).times(100).toFixed(1), 1)}%`
}
