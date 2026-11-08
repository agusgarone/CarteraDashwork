import { expect, it } from 'vitest'
import { formatBudgetNumber, parseBudgetNumber } from './numberInput'
it('acepta coma decimal y preserva la precisión de la cotización', () => {
  expect(parseBudgetNumber('1234,56')).toBe('1234.56')
  expect(parseBudgetNumber(formatBudgetNumber('1500.12345678'))).toBe(
    '1500.12345678',
  )
})
it('evita interpretar un separador de miles como un importe de un peso', () => {
  expect(() => parseBudgetNumber('1.000')).toThrow('separadores de miles')
  expect(() => parseBudgetNumber('1.000,50')).toThrow('separadores de miles')
})
