import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { reconcileCashLedger, type CashMovementLeg } from '../engine/calculations/cashLedger'
import { cashMovementLegsFromAccount } from '../import/cashMovementLegs'
import type { PdfTextDocument, PdfTextRow } from '../parsers/text/extractPdfText'
import { parseBalanzMonthlyAccountDocument, parseBalanzMonthlyAccountText } from '../parsers/balanz/monthlyAccount'

const COLUMNS =
  'Descripción | Cant. VN | Saldo | Precio | Bruto | Arancel Impor. | IVA Impor. | Derech Impor. | IVA | Neto | Fecha Co. | Fecha Li.'

function statement(body: string): string {
  return `Cuenta Corriente por Concertación del 1/7/2026 al 31/7/2026
${COLUMNS}
${body}`
}

function leg(partial: Partial<CashMovementLeg> & Pick<CashMovementLeg, 'currency' | 'amount' | 'role'>): CashMovementLeg {
  return {
    operationId: partial.operationId ?? '1',
    operationType: partial.operationType ?? partial.role,
    date: partial.date ?? '2026-07-03',
    ...partial,
  }
}

describe('patas de caja', () => {
  it('toma el neto de caja de una compra en pesos y no la cantidad por el precio', () => {
    const account = parseBalanzMonthlyAccountText(statement(`
CEDEAR SPY - SPY /1
Boleto / 7321990 / COMPRA / 1 / SPY / $ | 54,00 | | 19.860,00 | 1.072.440,00 | | | | | -1.079.577,09 | 3/7/2026 | 6/7/2026
Pesos - $
Boleto / 7321990 / COMPRA / 1 / SPY / $ | 54,00 | | | -1.079.577,09 | | | | | -1.079.577,09 | 3/7/2026 | 6/7/2026
`))
    expect(cashMovementLegsFromAccount(account)).toEqual([
      expect.objectContaining({
        operationId: '7321990',
        operationType: 'BUY',
        currency: 'ARS',
        amount: '-1079577.09',
        role: 'TRADE_SETTLEMENT',
      }),
    ])
  })

  it('conserva cada moneda de una compra con patas en dólares y en pesos', () => {
    const account = parseBalanzMonthlyAccountText(statement(`
YPF - YPFD /710
Boleto / 7321989 / COMPRA / 1 / YPFD / usd | 2,00 | | 46,99 | 93,98 | | | | | -94,61 | 3/7/2026 | 6/7/2026
Pesos - $
Boleto / 7321989 / COMPRA / 1 / YPFD / usd | | | | -1.250,00 | | | | | -1.250,00 | 3/7/2026 | 6/7/2026
Dólar MEP - usd
Boleto / 7321989 / COMPRA / 1 / YPFD / usd | 2,00 | | 46,99 | -94,61 | | | | | -94,61 | 3/7/2026 | 6/7/2026
`))
    const legs = cashMovementLegsFromAccount(account)
    expect(legs).toEqual([
      expect.objectContaining({ operationId: '7321989', currency: 'ARS', amount: '-1250.00', role: 'TRADE_SETTLEMENT' }),
      expect.objectContaining({ operationId: '7321989', currency: 'USD_MEP', amount: '-94.61', role: 'TRADE_SETTLEMENT' }),
    ])
  })

  it('suma el neto de una venta', () => {
    const account = parseBalanzMonthlyAccountText(statement(`
GD35 - GD35 /1
Boleto / 8215031 / VENTA / 1 / GD35 / $ | -1098,00 | | 1.254,80 | 1.377.770,40 | | | | | 1.370.847,11 | 29/7/2026 | 30/7/2026
Pesos - $
Boleto / 8215031 / VENTA / 1 / GD35 / $ | | | | 1.370.847,11 | | | | | 1.370.847,11 | 29/7/2026 | 30/7/2026
`))
    expect(cashMovementLegsFromAccount(account)).toEqual([
      expect.objectContaining({ currency: 'ARS', amount: '1370847.11', role: 'TRADE_SETTLEMENT' }),
    ])
  })

  it('deja una sola salida de caja por suscripción y no cuenta la transferencia a custodia', () => {
    const account = parseBalanzMonthlyAccountText(statement(`
BALANZ CAPITAL ACCIONES - BCACCA /1
Liquidación de Suscripción / 1415377 / BALANZ CAPITAL ACCIONES | 8264,47 | | | | | | | | | 3/7/2026 | 3/7/2026
Transferencia a Custodia de Balanz Soc. Gte. de FCI | -8264,47 | | | | | | | | | 3/7/2026 | 3/7/2026
Pesos - $
Liquidación de Suscripción / 1415377 / BALANZ CAPITAL ACCIONES | | | | -1.350.000,00 | | | | | -1.350.000,00 | 3/7/2026 | 3/7/2026
`))
    expect(account.transactions.filter((movement) => movement.type === 'FUND_SUBSCRIPTION')).toHaveLength(1)
    expect(account.warnings).toEqual([])
    expect(account.operationGroups.some((group) => group.operationType === 'KNOWN_NON_ECONOMIC')).toBe(true)
    expect(cashMovementLegsFromAccount(account)).toEqual([
      expect.objectContaining({
        operationId: '1415377',
        currency: 'ARS',
        amount: '-1350000.00',
        role: 'FUND_SETTLEMENT',
      }),
    ])
  })

  it('arma las dos patas de una conversión sin netearlas en el detalle', () => {
    const account = parseBalanzMonthlyAccountText(statement(`
Dólares CV 7000 - U$ 7000
Movimiento Manual / Conversión CV 7.000 a CV 10.000 (dólar mep) | | | | -177,80 | | | | | -177,80 | 31/7/2026 | 4/8/2026
Dólar MEP - usd
Movimiento Manual / Conversión CV 7.000 a CV 10.000 (dólar mep) | | | | 177,80 | | | | | 177,80 | 31/7/2026 | 4/8/2026
`))
    const legs = cashMovementLegsFromAccount(account)
    expect(legs).toEqual([
      expect.objectContaining({ currency: 'USD_CABLE', amount: '-177.80', role: 'FX_CONVERSION' }),
      expect.objectContaining({ currency: 'USD_MEP', amount: '177.80', role: 'FX_CONVERSION' }),
    ])
    expect(legs.every((item) => item.operationId === legs[0]?.operationId)).toBe(true)
  })

  it('firma aporte, dividendo, renta e impuesto con el neto del documento', () => {
    const account = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Recibo de Cobro / 1792564 | | | | 1.800.000,00 | | | | | 1.800.000,00 | 2/7/2026 | 2/7/2026
Dividendo en efectivo / KO | | | | -6,58 | | | | | -6,58 | 2/7/2026 | 2/7/2026
Renta / GD35 | | | | -17,09 | | | | | -17,09 | 10/7/2026 | 10/7/2026
Movimiento Manual / N/D Ret IIGG y BBPP - GGAL | | | | -11,62 | | | | | -11,62 | 13/7/2026 | 13/7/2026
`))
    const legs = cashMovementLegsFromAccount(account)
    expect(legs.map((item) => `${item.role}:${item.amount}`)).toEqual([
      'EXTERNAL_FLOW:1800000.00',
      'DIVIDEND:-6.58',
      'INTEREST:-17.09',
      'TAX:-11.62',
    ])
  })
})

describe('ledger por moneda', () => {
  it('cierra el saldo sumando patas firmadas', () => {
    const result = reconcileCashLedger({
      opening: [{ currency: 'ARS', amount: '100.00' }],
      closing: [{ currency: 'ARS', amount: '40.00' }],
      legs: [
        leg({ role: 'EXTERNAL_FLOW', currency: 'ARS', amount: '50.00' }),
        leg({ role: 'TRADE_SETTLEMENT', currency: 'ARS', amount: '-80.00' }),
        leg({ role: 'DIVIDEND', currency: 'ARS', amount: '-30.00' }),
      ],
    })
    expect(result.status).toBe('RECONCILED')
    expect(result.currencies[0]).toMatchObject({
      openingAmount: '100.00',
      movementsTotal: '-60.00',
      closingAmount: '40.00',
      difference: '0.00',
    })
  })
})

describe('caja real de julio 2026', () => {
  const layout = JSON.parse(
    readFileSync(new URL('../parsers/balanz/fixtures/july2026-monthly-account.layout.json', import.meta.url), 'utf8'),
  ) as { items: { page: number; text: string; x: number; y: number; width: number }[] }
  const account = parseBalanzMonthlyAccountDocument(documentFromLayout(layout.items))
  const legs = cashMovementLegsFromAccount(account)
  const ledger = reconcileCashLedger({
    opening: [
      { currency: 'ARS', amount: '2059863.56' },
      { currency: 'USD_MEP', amount: '105.23' },
      { currency: 'USD_CABLE', amount: '173.89' },
    ],
    closing: [
      { currency: 'ARS', amount: '17658.61' },
      { currency: 'USD_MEP', amount: '188.58' },
      { currency: 'USD_CABLE', amount: '0.00' },
    ],
    legs,
  })

  it('no avisa las transferencias a custodia y no las convierte en caja', () => {
    expect(account.warnings).toEqual([])
    expect(account.operationGroups.filter((group) => group.operationType === 'KNOWN_NON_ECONOMIC')).toHaveLength(2)
    expect(legs.some((item) => item.amount === '0.00' && item.operationType === 'KNOWN_NON_ECONOMIC')).toBe(false)
    expect(account.transactions.some((movement) => /custodia/i.test(movement.sourceReference))).toBe(false)
  })

  it('cierra ARS, dólar MEP y dólar cable con las patas firmadas', () => {
    expect(ledger.status).toBe('RECONCILED')
    expect(ledger.currencies.map((currency) => ({
      currency: currency.currency,
      openingAmount: currency.openingAmount,
      movementsTotal: currency.movementsTotal,
      closingAmount: currency.closingAmount,
      difference: currency.difference,
      status: currency.status,
      roles: currency.roles,
    }))).toEqual([
      {
        currency: 'ARS',
        openingAmount: '2059863.56',
        movementsTotal: '-2042204.95',
        closingAmount: '17658.61',
        difference: '0.00',
        status: 'RECONCILED',
        roles: {
          externalFlows: '1800000.00',
          tradeSettlements: '-1062053.50',
          fundSettlements: '-2780279.89',
          dividends: '159.02',
          interest: '-18.96',
          taxes: '-11.62',
          fxConversions: '0.00',
          fees: '0.00',
          other: '0.00',
        },
      },
      {
        currency: 'USD_MEP',
        openingAmount: '105.23',
        movementsTotal: '83.35',
        closingAmount: '188.58',
        difference: '0.00',
        status: 'RECONCILED',
        roles: {
          externalFlows: '0.00',
          tradeSettlements: '-94.45',
          fundSettlements: '0.00',
          dividends: '0.00',
          interest: '0.00',
          taxes: '0.00',
          fxConversions: '177.80',
          fees: '0.00',
          other: '0.00',
        },
      },
      {
        currency: 'USD_CABLE',
        openingAmount: '173.89',
        movementsTotal: '-173.89',
        closingAmount: '0.00',
        difference: '0.00',
        status: 'RECONCILED',
        roles: {
          externalFlows: '0.00',
          tradeSettlements: '-95.75',
          fundSettlements: '0.00',
          dividends: '1.03',
          interest: '98.63',
          taxes: '0.00',
          fxConversions: '-177.80',
          fees: '0.00',
          other: '0.00',
        },
      },
    ])

    const byOperation = new Map<string, typeof legs>()
    for (const item of legs) {
      const key = item.operationId ?? item.date
      byOperation.set(key, [...(byOperation.get(key) ?? []), item])
    }
    const multiple = [...byOperation.values()].filter((items) => items.length > 1)
    expect(multiple.some((items) =>
      items.some((item) => item.currency === 'ARS' && item.role === 'TRADE_SETTLEMENT') &&
      items.some((item) => item.currency === 'USD_MEP' && item.role === 'TRADE_SETTLEMENT'),
    )).toBe(true)
    const fxPairs = multiple
      .map((items) => items.filter((item) => item.role === 'FX_CONVERSION'))
      .filter((items) => items.length === 2)
    expect(fxPairs).toEqual([
      [
        expect.objectContaining({ currency: 'USD_CABLE', amount: '-95.75' }),
        expect.objectContaining({ currency: 'USD_CABLE', amount: '95.75' }),
      ],
      [
        expect.objectContaining({ currency: 'USD_CABLE', amount: '-177.80' }),
        expect.objectContaining({ currency: 'USD_MEP', amount: '177.80' }),
      ],
    ])
  })
})

function documentFromLayout(
  items: readonly { page: number; text: string; x: number; y: number; width: number }[],
): PdfTextDocument {
  const grouped = new Map<string, PdfTextRow>()
  for (const item of items) {
    const key = `${item.page}:${item.y}`
    const row = grouped.get(key) ?? { page: item.page, y: item.y, items: [] }
    row.items.push({ text: item.text, x: item.x, width: item.width })
    grouped.set(key, row)
  }
  const rows = [...grouped.values()]
    .sort((left, right) => left.page - right.page || right.y - left.y)
    .map((row) => ({ ...row, items: [...row.items].sort((left, right) => left.x - right.x) }))
  return {
    pageCount: rows.reduce((max, row) => Math.max(max, row.page), 0),
    rows,
    text: rows.map((row) => row.items.map((item) => item.text).join(' ')).join('\n'),
  }
}
