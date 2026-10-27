import Decimal from 'decimal.js'
import type { PeriodFxReference } from '../domain/periodFxReference'
import { formatDecimal, formatQuantity } from '../utils/formatCurrency'
import { formatDate } from '../utils/formatDate'

export type DisplayCurrency = 'ARS' | 'USD'
export type AvailableFxReference = Extract<PeriodFxReference, { status: 'AVAILABLE' }>
export interface DisplaySettings { currency: DisplayCurrency; referenceFx: AvailableFxReference | null }
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export function convertForDisplay(input: { amountArs: string; currency: DisplayCurrency; usdMepRate?: string | null }): string {
  if (input.currency === 'ARS') return input.amountArs
  const amount = new Money(input.amountArs)
  const rate = new Money(input.usdMepRate ?? 'NaN')
  if (!amount.isFinite() || !rate.isFinite() || !rate.gt(0)) throw new Error('La visualización USD requiere una referencia MEP válida.')
  return amount.div(rate).toFixed()
}

export function formatDisplayAmount(amountArs: string, settings: DisplaySettings, options: { signed?: boolean; decimals?: number } = {}): string {
  const value = new Money(convertForDisplay({ amountArs, currency: settings.currency, usdMepRate: settings.referenceFx?.rate }))
  const negative = value.isNegative() && !value.isZero()
  const sign = negative ? '-' : options.signed && value.gt(0) ? '+' : ''
  const prefix = settings.currency === 'USD' ? 'USD ' : '$'
  return `${sign}${prefix}${formatDecimal(value.abs().toFixed(options.decimals ?? 2), options.decimals ?? 2)}`
}

export function displayReferenceLegend(reference: AvailableFxReference): string {
  return `USD MEP · cierre ${formatDate(reference.date)} · $${formatDecimal(reference.rate, 2)}/USD`
}

export function createDisplayPresenter(settings: DisplaySettings) {
  return {
    ...settings,
    format: (value: string) => formatDisplayAmount(value, settings),
    signed: (value: string) => formatDisplayAmount(value, settings, { signed: true }),
    precise: (value: string) => formatDisplayAmount(value, settings, { decimals: 8, signed: true }),
    toDisplayValue: (value: string) => convertForDisplay({ amountArs: value, currency: settings.currency, usdMepRate: settings.referenceFx?.rate }),
  }
}

/** Decimal conversion first; JS numbers are only coordinates required by Recharts. */
export function projectChartValues<T>(points: readonly T[], amount: (point: T) => string, settings: DisplaySettings) {
  return points.map(point => {
    const displayValue = convertForDisplay({ amountArs: amount(point), currency: settings.currency, usdMepRate: settings.referenceFx?.rate })
    return { ...point, displayValue, chartValue: new Money(displayValue).toNumber() }
  })
}

export function formatDisplayAxis(value: number, currency: DisplayCurrency): string {
  const decimal = new Money(String(value))
  const abs = decimal.abs()
  const divisor = abs.gte('1000000') ? '1000000' : abs.gte('1000') ? '1000' : '1'
  const suffix = divisor === '1000000' ? ' M' : divisor === '1000' ? ' mil' : ''
  const text = formatQuantity(decimal.abs().div(divisor).toFixed(divisor === '1' ? 0 : 1))
  return `${decimal.lt(0) ? '-' : ''}${currency === 'USD' ? 'USD ' : '$'}${text}${suffix}`
}