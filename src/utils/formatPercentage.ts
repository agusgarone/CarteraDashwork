const percentageFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const weightFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

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
