import { expect, it } from 'vitest'
import { parseBalanzMonthlyAccountText } from '../../parsers/balanz/monthlyAccount'
import type {
  ParsedFundStatement,
  ParsedMonthlyFundStatement,
} from '../../parsers/models/parsedMonthlyFundStatement'
import { enrichFundSubscriptions } from './enrichFundSubscriptions'

const header = 'BALANZ AHORRO EN DOLARES A - BAHUSD A'
const account = parseBalanzMonthlyAccountText(
  'Resumen mensual comitente\n01/05/2026 al 31/05/2026\n' + header,
)
const fund: ParsedFundStatement = {
  categoryName: 'Corporativo',
  fundName: 'BALANZ AHORRO EN DOLARES FCI (Corporativo)',
  shareClass: 'A',
  currency: 'USD_MEP',
  rows: [
    {
      type: 'SUBSCRIPTION',
      date: '2026-05-06',
      unitValue: '1.410621',
      quantity: '658.483036',
      amount: '928.87',
      sourceReference: 'Suscripción',
    },
  ],
}
const fundStatement: ParsedMonthlyFundStatement = {
  broker: 'BALANZ',
  reportDate: '2026-05-31',
  funds: [fund],
  warnings: [],
}

it('conserva el código explícito y la clase del encabezado del comitente', () => {
  expect(account.fundInstruments).toEqual([
    { name: 'BALANZ AHORRO EN DOLARES A', shareClass: 'A', ticker: 'BAHUSD A' },
  ])
  const result = enrichFundSubscriptions({
    account,
    fundStatement,
    positions: [],
  })
  expect(result.transactions[0]).toMatchObject({
    type: 'FUND_SUBSCRIPTION',
    ticker: 'BAHUSD A',
    currency: 'USD_MEP',
    fundIdentity: {
      name: fund.fundName,
      shareClass: 'A',
      brokerCode: 'BAHUSD A',
    },
  })
})
it('no inventa identidad cuando el documento no trae código', () => {
  expect(() =>
    enrichFundSubscriptions({
      account: { ...account, fundInstruments: [] },
      fundStatement,
      positions: [],
    }),
  ).toThrow('No hay una identidad inequívoca')
})
it('no cruza otra clase ni nombres parecidos', () => {
  for (const instrument of [
    { name: 'BALANZ AHORRO EN DOLARES B', shareClass: 'B', ticker: 'BAHUSD B' },
    {
      name: 'BALANZ OTRO AHORRO EN DOLARES A',
      shareClass: 'A',
      ticker: 'OTRO A',
    },
  ]) {
    expect(() =>
      enrichFundSubscriptions({
        account: { ...account, fundInstruments: [instrument] },
        fundStatement,
        positions: [],
      }),
    ).toThrow('No hay una identidad inequívoca')
  }
})
it('rechaza códigos ambiguos para el mismo nombre y clase', () => {
  expect(() =>
    enrichFundSubscriptions({
      account: {
        ...account,
        fundInstruments: [
          ...account.fundInstruments!,
          { ...account.fundInstruments![0]!, ticker: 'OTRO A' },
        ],
      },
      fundStatement,
      positions: [],
    }),
  ).toThrow('No hay una identidad inequívoca')
})
