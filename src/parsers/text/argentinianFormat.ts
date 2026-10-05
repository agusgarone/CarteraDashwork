import Decimal from 'decimal.js'

/**
 * Lee un importe en formato argentino o ya normalizado.
 * "1.250.000,00" y "188,58" son válidos. No calcula rendimiento.
 */
export function parseArgentineNumber(raw: string): Decimal | null {
  const trimmed = raw.trim().replace(/\s/g, '')
  if (trimmed.length === 0) return null

  const argentine = trimmed.match(/^([+-])?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/)
  if (argentine) {
    const sign = argentine[1] === '-' ? -1 : 1
    const integer = argentine[2].replaceAll('.', '')
    const fraction = argentine[3] ?? ''
    const text = fraction.length > 0 ? `${integer}.${fraction}` : integer
    return new Decimal(text).times(sign)
  }

  const dotted = trimmed.match(/^([+-])?(\d+)\.(\d+)$/)
  if (dotted) {
    return new Decimal(`${dotted[1] ?? ''}${dotted[2]}.${dotted[3]}`)
  }

  return null
}

/** Importe de dinero con dos decimales y el signo que trae el documento. */
export function formatSignedMoney(value: Decimal): string {
  return value.toFixed(2)
}

/** Importe de dinero con dos decimales, en magnitud positiva. */
export function formatMoney(value: Decimal): string {
  return value.abs().toFixed(2)
}

/** Cantidad de títulos. Conserva los decimales significativos. */
export function formatQuantity(value: Decimal): string {
  return value.abs().toString()
}

/**
 * Importe impreso, sin agregar decimales que el token no trae.
 * "26.383.988" queda en escala 0. "4.507,50" conserva dos decimales.
 * "0.00" se lee como decimal inglés.
 */
export function readScaledAmount(raw: string): { value: Decimal; text: string } | null {
  const numeric = raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/^(?:usd|\$)/i, '')
  const value = parseArgentineNumber(numeric)
  if (!value) return null
  return { value, text: value.abs().toFixed(amountScale(numeric)) }
}

function amountScale(numeric: string): number {
  if (/^[+-]?\d{1,3}(?:\.\d{3})+(?:,(\d+))?$/.test(numeric) || /^[+-]?\d+(?:,(\d+))?$/.test(numeric)) {
    const comma = numeric.match(/,(\d+)$/)
    return comma?.[1].length ?? 0
  }
  const dot = numeric.match(/^[+-]?\d+\.(\d+)$/)
  return dot?.[1].length ?? 0
}

/** Resultado calculado, sin recortar decimales ni forzar centavos. */
export function formatCalculated(value: Decimal): string {
  return value.toFixed()
}

/** Fecha Balanz, con o sin ceros a la izquierda, a YYYY-MM-DD. */
export function parseBalanzDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (month < 1 || month > 12) return null

  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const limit = daysInMonth[month - 1]
  if (limit === undefined || day < 1 || day > limit) return null

  const paddedMonth = String(month).padStart(2, '0')
  const paddedDay = String(day).padStart(2, '0')
  return `${year}-${paddedMonth}-${paddedDay}`
}
