import { expect, it } from 'vitest'
import { resolveFundDenomination } from './fundDenominationAliases'

it('resuelve ambas denominaciones dentro de la misma identidad de clase y moneda', () => {
  const old = resolveFundDenomination(
    'BALANZ PERFORMANCE II clase A',
    'A',
    'ARS',
  )
  const current = resolveFundDenomination('BALANZ LECAPS', 'A', 'ARS')
  expect(old?.canonicalIdentity).toBe('CNV:81959|A|ARS')
  expect(old?.canonicalIdentity).toBe(current?.canonicalIdentity)
  expect(old?.rawName).toBe('BALANZ PERFORMANCE II clase A')
  expect(current?.rawName).toBe('BALANZ LECAPS')
  expect(old?.reason).toBe('KNOWN_FUND_DENOMINATION_ALIAS')
  expect(old?.provenance.registryRecord).toBe('81959')
  expect(old).not.toHaveProperty('effectiveFrom')
})
it('mantiene separadas las clases y rechaza nombres de otra clase', () => {
  expect(
    resolveFundDenomination('BALANZ LECAPS', 'B', 'ARS')?.canonicalIdentity,
  ).toBe('CNV:81959|B|ARS')
  expect(
    resolveFundDenomination('BALANZ PERFORMANCE II clase B', 'A', 'ARS'),
  ).toBeNull()
})
it('no resuelve otra moneda ni nombres parecidos', () => {
  expect(resolveFundDenomination('BALANZ LECAPS', 'A', 'USD_MEP')).toBeNull()
  expect(resolveFundDenomination('BALANZ LECAPS PLUS', 'A', 'ARS')).toBeNull()
})

it('normaliza únicamente códigos documentados de la misma clase', async () => {
  const { canonicalFundBrokerCode } = await import('./fundDenominationAliases')
  expect(canonicalFundBrokerCode('PER2 A')).toBe('PER2 A')
  expect(canonicalFundBrokerCode('LECAPSA')).toBe('PER2 A')
  expect(canonicalFundBrokerCode('PER2 B')).toBe('PER2 B')
  expect(canonicalFundBrokerCode('C')).toBe('C')
})
