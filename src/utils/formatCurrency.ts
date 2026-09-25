const amountFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const decimalFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatAbs(value: number) {
  const abs = Math.abs(value)
  const formatter = Number.isInteger(abs) ? amountFormatter : decimalFormatter
  return formatter.format(abs)
}

/** $26.383.988, -$1.000.000, or +$179.959 when signed. */
export function formatCurrency(value: number, options?: { signed?: boolean }) {
  const sign = value < 0 ? '-' : options?.signed && value > 0 ? '+' : ''
  return `${sign}$${formatAbs(value)}`
}

export function formatSignedCurrency(value: number) {
  return formatCurrency(value, { signed: true })
}
