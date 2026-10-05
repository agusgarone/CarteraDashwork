import type { CurrencyCode } from '../domain/currency'
import type { ParsedFundStatement } from '../parsers/models/parsedMonthlyFundStatement'

/**
 * Identidad compartida entre la posición consolidada y el resumen de fondos.
 * La consolidada no trae el nombre legal del fondo, y el cuotapartista no trae ticker.
 * La clave es categoría normalizada, clase y moneda: acciones|A|ARS.
 * No aproxima nombres parecidos.
 */
export function fundMatchKey(category: string, shareClass: string, currency: CurrencyCode): string | null {
  const categoryKey = slug(category)
  const classKey = normalizeShareClass(shareClass)
  if (!categoryKey || !classKey) return null
  return `${categoryKey}|${classKey}|${currency}`
}

/** "Acciones Clase A" → acciones|A|ARS. El ticker no entra en la clave. */
export function fundMatchKeyFromConsolidatedName(name: string, currency: CurrencyCode): string | null {
  const match = name.trim().match(/^(.*?)\s+clase\s+([A-Za-z0-9]+)\s*$/i)
  if (!match) return null
  return fundMatchKey(match[1] ?? '', match[2] ?? '', currency)
}

export function fundMatchKeyFromStatement(fund: ParsedFundStatement): string | null {
  if (fund.shareClass === null) return null
  return fundMatchKey(fund.categoryName, fund.shareClass, fund.currency)
}

/** Categoría y clase, sin moneda. Sirve para distinguir "no hay fondo" de "la moneda no coincide". */
export function fundClassKey(category: string, shareClass: string): string | null {
  const categoryKey = slug(category)
  const classKey = normalizeShareClass(shareClass)
  if (!categoryKey || !classKey) return null
  return `${categoryKey}|${classKey}`
}

export function fundClassKeyFromConsolidatedName(name: string): string | null {
  const match = name.trim().match(/^(.*?)\s+clase\s+([A-Za-z0-9]+)\s*$/i)
  if (!match) return null
  return fundClassKey(match[1] ?? '', match[2] ?? '')
}

export function fundClassKeyFromStatement(fund: ParsedFundStatement): string | null {
  if (fund.shareClass === null) return null
  return fundClassKey(fund.categoryName, fund.shareClass)
}

function normalizeShareClass(shareClass: string): string | null {
  const token = shareClass.trim().replace(/^clase\s+/i, '').trim()
  if (!/^[A-Za-z0-9]+$/.test(token)) return null
  return token.toUpperCase()
}

function slug(value: string): string | null {
  const text = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '-')
  if (!text || !/^[a-z0-9-]+$/.test(text)) return null
  return text
}
