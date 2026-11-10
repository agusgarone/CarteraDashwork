import { expect, it } from 'vitest'
import { parseArgentineNumber, readScaledAmount } from './argentinianFormat'

it.each([
  ['123,45', '123.45'],
  ['-123,45', '-123.45'],
  ['(123,45)', '-123.45'],
  ['(658,483036)', '-658.483036'],
])('lee el número contable %s', (raw, expected) => {
  expect(parseArgentineNumber(raw)?.toString()).toBe(expected)
  expect(readScaledAmount(raw)?.value.toString()).toBe(expected)
})
it.each(['(texto)', 'saldo (123,45)', '(-123,45)', '(123,45', '123,45)'])(
  'rechaza texto fuera de una celda numérica válida %s',
  (raw) => {
    expect(parseArgentineNumber(raw)).toBeNull()
  },
)
it('conserva los seis decimales de cuotapartes contables', () => {
  expect(readScaledAmount('(658,483036)')?.text).toBe('658.483036')
})
