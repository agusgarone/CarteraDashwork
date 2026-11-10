import { expect, it } from 'vitest'
import { parseBalanzMonthlyAccountText } from '../../parsers/balanz/monthlyAccount'
import type { ParsedMonthlyFundStatement } from '../../parsers/models/parsedMonthlyFundStatement'
import { enrichFundSubscriptions } from './enrichFundSubscriptions'

function fixture(
  name = 'BALANZ LECAPS',
  currency: 'ARS' | 'USD_MEP' = 'ARS',
  shareClass = 'A',
) {
  const account = parseBalanzMonthlyAccountText(
    'Resumen mensual comitente\n01/08/2026 al 31/08/2026\nBALANZ PERFORMANCE II clase A - PER2 A',
  )
  const fundStatement: ParsedMonthlyFundStatement = {
    broker: 'BALANZ',
    reportDate: '2026-08-31',
    warnings: [],
    funds: [
      {
        categoryName: 'Lecaps',
        fundName: name,
        shareClass,
        currency,
        rows: [
          {
            type: 'SUBSCRIPTION',
            date: '2026-08-07',
            quantity: '10.000000',
            unitValue: '2.000000',
            amount: '20.00',
            sourceReference: name + ' / Suscripción',
          },
          {
            type: 'REDEMPTION',
            date: '2026-08-18',
            quantity: '-10.000000',
            unitValue: '2.100000',
            amount: '21.00',
            sourceReference: name + ' / Rescate',
          },
        ],
      },
    ],
  }
  return { account, fundStatement, positions: [] }
}
it('el alias es metadata y no genera diferencias económicas ni acciones corporativas', () => {
  const input = fixture()
  const original = structuredClone(input)
  const current = enrichFundSubscriptions(input)
  const historical = enrichFundSubscriptions(fixture('BALANZ PERFORMANCE II'))
  const economic = (result: typeof current) =>
    result.transactions.map(
      ({ type, ticker, date, quantity, currency, grossAmount, netAmount }) => ({
        type,
        ticker,
        date,
        quantity,
        currency,
        grossAmount,
        netAmount,
      }),
    )
  expect(economic(current)).toEqual(economic(historical))
  expect(current.transactions.map((row) => row.type)).toEqual([
    'FUND_SUBSCRIPTION',
    'FUND_REDEMPTION',
  ])
  expect(current.transactions.every((row) => row.ticker === 'PER2 A')).toBe(
    true,
  )
  expect(current.corporateActions).toEqual([])
  expect(input).toEqual(original)
  expect(
    current.transactions[0]!.fundIdentity?.denominations?.map(
      (row) => row.rawName,
    ),
  ).toEqual(['BALANZ LECAPS', 'BALANZ PERFORMANCE II clase A'])
})
it('no mezcla otra clase ni otra moneda con el alias de clase A en pesos', () => {
  expect(() =>
    enrichFundSubscriptions(fixture('BALANZ LECAPS', 'ARS', 'B')),
  ).toThrow('Falta un código documental')
  expect(() =>
    enrichFundSubscriptions(fixture('BALANZ LECAPS', 'USD_MEP')),
  ).toThrow('La moneda del alias')
})
it('reutiliza el instrumento existente bajo el otro código documental sin duplicarlo', () => {
  const result = enrichFundSubscriptions({
    ...fixture(),
    knownFunds: [
      {
        id: 'existing',
        ticker: 'LECAPSA',
        name: 'BALANZ LECAPS - Clase A',
        category: 'FUND',
        currency: 'ARS',
        brokerIdentifier: 'LECAPSA',
        createdAt: '',
      },
    ],
  })
  expect(result.transactions.every((row) => row.ticker === 'LECAPSA')).toBe(
    true,
  )
})

it('rechaza una moneda contradictoria en el código previamente guardado', () => {
  expect(() =>
    enrichFundSubscriptions({
      ...fixture(),
      knownFunds: [
        {
          id: 'existing',
          ticker: 'LECAPSA',
          name: 'BALANZ LECAPS - Clase A',
          category: 'FUND',
          currency: 'USD_MEP',
          brokerIdentifier: 'LECAPSA',
          createdAt: '',
        },
      ],
    }),
  ).toThrow('La moneda guardada')
})
