import { describe, expect, it } from 'vitest'
import { formatCurrencyARS, formatDecimal, formatQuantity, formatSignedCurrencyARS } from './formatCurrency'
import { formatReturnPercent } from './formatPercentage'
import { originalExtension } from '../import/documentStore'

describe('formatDecimal', () => {
  it('muestra el resultado de agosto en pesos argentinos', () => {
    expect(formatCurrencyARS('26383988')).toBe('$26.383.988,00')
    expect(formatSignedCurrencyARS('179959.00')).toBe('+$179.959,00')
    expect(formatCurrencyARS('179959.00')).toBe('$179.959,00')
    expect(formatCurrencyARS('179958.1360')).toBe('$179.958,14')
    expect(formatCurrencyARS('0.8640')).toBe('$0,86')
    expect(formatDecimal('8424.2160', 4)).toBe('8.424,2160')
    expect(formatDecimal('-144.17')).toBe('-144,17')
    expect(formatQuantity('13')).toBe('13')
    expect(formatQuantity('14860.792493')).toBe('14.860,792493')
    expect(formatQuantity('3214.592773')).toBe('3.214,592773')
    expect(formatReturnPercent('0.006749211725095')).toBe('+0,67%')
    expect(formatReturnPercent('0.006749211725095')).not.toBe('+7,12%')
    expect(formatReturnPercent('-0.01234')).toBe('-1,23%')
  })

  it('conserva la extensión del archivo original', () => {
    expect(originalExtension('ResumenDeCuenta.pdf')).toBe('.pdf')
    expect(originalExtension('C:\\Users\\cuenta\\Resumen.PDF')).toBe('.pdf')
    expect(originalExtension('futuro.xlsx')).toBe('.xlsx')
  })
})
