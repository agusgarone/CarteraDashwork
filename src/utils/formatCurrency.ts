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

/** Muestra un DecimalString en pesos, sin convertirlo a number para calcular. */
export function formatCurrencyARS(value: string): string {
  return `$${formatDecimal(value, 2)}`
}

/** Cantidad persistida. 14860.792493 → 14.860,792493. No redondea a entero. */
export function formatQuantity(value: string): string {
  const negative = value.trim().startsWith('-')
  const [wholeRaw, fraction = ''] = value.trim().replace(/^[+-]/, '').split('.')
  const whole = trimLeadingZeros(wholeRaw || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const trimmed = fraction.replace(/0+$/, '')
  return `${negative ? '-' : ''}${trimmed ? `${whole},${trimmed}` : whole}`
}

/** +$179.959,00 o -$1.000,00. El cero no lleva signo. */
export function formatSignedCurrencyARS(value: string): string {
  const formatted = formatCurrencyARS(value)
  if (value.trim().startsWith('-') || !/[1-9]/.test(value)) return formatted
  return `+${formatted}`
}

/** Agrupación es-AR. Los decimales se muestran; no se usan para un cálculo. */
export function formatDecimal(value: string, fractionDigits = 2): string {
  const negative = value.trim().startsWith('-')
  const [whole, fraction = ''] = value.trim().replace('-', '').split('.')
  const digits = `${fraction}${'0'.repeat(fractionDigits)}`.slice(0, fractionDigits + 1)
  const keep = digits.slice(0, fractionDigits)
  const roundUp = (digits[fractionDigits] ?? '0') >= '5'
  const rounded = roundUp ? incrementDecimal(whole || '0', keep) : { whole: trimLeadingZeros(whole || '0'), fraction: keep }
  const grouped = rounded.whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '-' : ''}${grouped},${rounded.fraction}`
}

function trimLeadingZeros(value: string): string {
  const trimmed = value.replace(/^0+(?=\d)/, '')
  return trimmed.length > 0 ? trimmed : '0'
}

function incrementDecimal(whole: string, fraction: string): { whole: string; fraction: string } {
  const fractionDigits = fraction.split('').map((digit) => Number(digit))
  let carry = 1
  for (let index = fractionDigits.length - 1; index >= 0; index -= 1) {
    const next = (fractionDigits[index] ?? 0) + carry
    fractionDigits[index] = next % 10
    carry = next >= 10 ? 1 : 0
  }
  const nextWhole = carry === 1 ? incrementWhole(trimLeadingZeros(whole)) : trimLeadingZeros(whole)
  return { whole: nextWhole, fraction: fractionDigits.join('') }
}

function incrementWhole(value: string): string {
  const digits = value.split('').map((digit) => Number(digit))
  let carry = 1
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const next = (digits[index] ?? 0) + carry
    digits[index] = next % 10
    carry = next >= 10 ? 1 : 0
  }
  if (carry === 1) digits.unshift(1)
  return digits.join('')
}
