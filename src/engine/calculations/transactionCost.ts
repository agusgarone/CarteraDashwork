import type { DecimalString } from '../../domain/common'
import { formatExact, parseDecimal, zeroDecimal } from '../money'

export interface TransactionCostBreakdown {
  commission: DecimalString
  vat: DecimalString
  marketFees: DecimalString
  taxes: DecimalString
  other: DecimalString
  total: DecimalString
}

export interface CostComponentInput {
  commission?: DecimalString | null
  vat?: DecimalString | null
  marketFees?: DecimalString | null
  taxes?: DecimalString | null
}

const EMPTY: TransactionCostBreakdown = {
  commission: '0.00',
  vat: '0.00',
  marketFees: '0.00',
  taxes: '0.00',
  other: '0.00',
  total: '0.00',
}

/**
 * Costo de una compra o venta a partir del bruto del instrumento y el neto de caja
 * de la misma moneda. Una compra cuesta la diferencia entre lo pagado y el bruto.
 * Una venta cuesta la diferencia entre el bruto y lo cobrado.
 */
export function economicTradeCost(side: 'BUY' | 'SELL', gross: DecimalString, cashNet: DecimalString): DecimalString {
  const gap = parseDecimal(cashNet).abs().minus(parseDecimal(gross).abs())
  const cost = side === 'BUY' ? gap : gap.neg()
  return formatExact(cost)
}

/**
 * Elige el subconjunto de columnas que suma exactamente el costo.
 * Si una columna repite un importe que ya está en otra, queda afuera.
 * Si ninguna combinación cierra, el total queda en other.
 */
export function allocateTransactionCost(
  components: CostComponentInput,
  total: DecimalString,
): TransactionCostBreakdown {
  const target = parseDecimal(total)
  if (target.isZero()) return { ...EMPTY }

  const available = (
    [
      ['commission', components.commission],
      ['vat', components.vat],
      ['marketFees', components.marketFees],
      ['taxes', components.taxes],
    ] as const
  )
    .map(([field, amount]) => ({ field, amount: amount ? parseDecimal(amount) : zeroDecimal() }))
    .filter((part) => !part.amount.isZero())

  let chosen: typeof available | null = null
  for (let mask = 1; mask < 2 ** available.length; mask += 1) {
    const subset = available.filter((_, index) => (mask & (2 ** index)) !== 0)
    const sum = subset.reduce((totalAmount, part) => totalAmount.plus(part.amount), zeroDecimal())
    if (!sum.eq(target)) continue
    if (!chosen || subset.length > chosen.length) chosen = subset
  }

  const selected = new Set(chosen?.map((part) => part.field) ?? [])
  const commission = selected.has('commission') ? parseDecimal(components.commission ?? '0') : zeroDecimal()
  const vat = selected.has('vat') ? parseDecimal(components.vat ?? '0') : zeroDecimal()
  const marketFees = selected.has('marketFees') ? parseDecimal(components.marketFees ?? '0') : zeroDecimal()
  const taxes = selected.has('taxes') ? parseDecimal(components.taxes ?? '0') : zeroDecimal()
  const named = commission.plus(vat).plus(marketFees).plus(taxes)
  const other = target.minus(named)

  return {
    commission: formatExact(commission),
    vat: formatExact(vat),
    marketFees: formatExact(marketFees),
    taxes: formatExact(taxes),
    other: formatExact(other),
    total: formatExact(target),
  }
}

export function emptyTransactionCost(): TransactionCostBreakdown {
  return { ...EMPTY }
}
