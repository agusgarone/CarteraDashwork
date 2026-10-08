import { describe, expect, it } from 'vitest'
import { enrichFundSubscriptions } from '../../import/enrichment/enrichFundSubscriptions'
import { ImportPeriodParsingError } from '../../import/importPeriodErrors'
import { assertMonthlyAccountReadable } from '../../import/monthlyAccountGuard'
import type { PdfTextDocument, PdfTextItem, PdfTextRow } from '../text/extractPdfText'
import { parseBalanzMonthlyAccountDocument, parseBalanzMonthlyAccountText } from './monthlyAccount'

const COLUMNS =
  'Descripción | Cant. VN | Saldo | Precio | Bruto | Arancel Impor. | IVA Impor. | Derech Impor. | IVA | Neto | Fecha Co. | Fecha Li.'

function statement(body: string): string {
  return `Cuenta Corriente por Concertación del 1/7/2026 al 31/7/2026
${COLUMNS}
${body}`
}

function item(text: string, x: number, width = 24): PdfTextItem {
  return { text, x, width }
}

function row(y: number, items: PdfTextItem[], page = 1): PdfTextRow {
  return { page, y, items }
}

function document(rows: PdfTextRow[]): PdfTextDocument {
  const pages = new Set(rows.map((entry) => entry.page))
  const text = [
    'Cuenta Corriente por Concertación del 1/7/2026 al 31/7/2026',
    ...rows.map((entry) => entry.items.map((entryItem) => entryItem.text).join(' ')),
  ].join('\n')
  return { pageCount: pages.size, rows, text }
}

function julyHeader(page: number, y: number): PdfTextRow[] {
  return [
    row(y + 10, [
      item('Arancel', 491, 29),
      item('IVA', 552, 13),
      item('Derech', 597, 27),
      item('Fecha', 740, 22),
      item('Fecha', 782, 22),
    ], page),
    row(y, [
      item('Descripción', 23, 52),
      item('Cant. VN', 304, 36),
      item('Saldo', 346, 24),
      item('Precio', 375, 28),
      item('Bruto', 445, 24),
      item('IVA', 656, 13),
      item('Neto', 681, 20),
    ], page),
    row(y - 5, [
      item('Impor.', 491, 25),
      item('Impor.', 552, 25),
      item('Impor.', 597, 25),
      item('Co.', 740, 12),
      item('Li.', 782, 9),
    ], page),
  ]
}

describe('encabezado posicional de Julio', () => {
  it('une Fecha y Co. aunque estén en filas distintas y usa esa fecha', () => {
    const parsed = parseBalanzMonthlyAccountDocument(document([
      ...julyHeader(1, 447),
      row(420, [item('Pesos - $', 23, 48)]),
      row(400, [
        item('Recibo de Cobro / 1792564', 23, 150),
        item('1.800.000,00', 445, 70),
        item('1.800.000,00', 700, 70),
        item('2/7/2026', 740, 42),
        item('3/7/2026', 782, 42),
      ]),
    ]))

    expect(parsed.transactions).toEqual([
      expect.objectContaining({
        type: 'CONTRIBUTION',
        date: '2026-07-02',
        currency: 'ARS',
        netAmount: '1800000.00',
        grossAmount: '1800000.00',
      }),
    ])
    expect(parsed.operationGroups[0]).toMatchObject({
      operationReference: '1792564',
      date: '2026-07-02',
      settlementDate: '2026-07-03',
    })
  })

  it('junta la descripción con los importes cuando Balanz los separa unos píxeles', () => {
    const parsed = parseBalanzMonthlyAccountDocument(document([
      ...julyHeader(1, 447),
      row(420, [item('Pesos - $', 23, 48)]),
      row(400, [item('Liquidación de Suscripción / 1415377 / BALANZ CAPITAL ACCIONES', 23, 233)]),
      row(394, [
        item('-1.350.000,00', 447, 47),
        item('-1.350.000,00', 682, 47),
        item('3/7/2026', 741, 31),
        item('3/7/2026', 782, 31),
      ]),
    ]))

    expect(parsed.transactions).toEqual([
      expect.objectContaining({
        type: 'FUND_SUBSCRIPTION',
        date: '2026-07-03',
        netAmount: '1350000.00',
        currency: 'ARS',
        ticker: null,
      }),
    ])
  })

  it('parte un ítem numérico que cruza Precio, Bruto y Arancel', () => {
    const parsed = parseBalanzMonthlyAccountDocument(document([
      ...julyHeader(1, 447),
      row(420, [item('CEDEAR SPY - SPY /1', 23, 120)]),
      row(400, [
        item('Boleto / 7321990 / COMPRA / 1 / SPY / $', 23, 220),
        item('54,00', 304, 28),
        item('19.860,0000000000 1.072.440,00 5362,20', 375, 200),
        item('1.077.802,20', 700, 70),
        item('3/7/2026', 740, 42),
        item('6/7/2026', 782, 42),
      ]),
    ]))

    expect(parsed.transactions[0]).toMatchObject({
      type: 'BUY',
      ticker: 'SPY',
      quantity: '54',
      unitPrice: '19860.00',
      grossAmount: '1072440.00',
      fees: '5362.20',
      date: '2026-07-03',
    })
  })
})

describe('agrupación por boleto', () => {
  it('convierte las patas de un mismo boleto en una sola compra', () => {
    const parsed = parseBalanzMonthlyAccountText(statement(`
CEDEAR SPY - SPY /1
Boleto / 7321990 / COMPRA / 1 / SPY / $ | 54,00 | | 19.860,0000000000 | 1.072.440,00 | 5.362,20 | | | | 1.077.802,20 | 3/7/2026 | 6/7/2026
Pesos - $
Boleto / 7321990 / COMPRA / 1 / SPY / $ | 54,00 | | 0,0000000000 | -1.077.802,20 | | | | | -1.077.802,20 | 3/7/2026 | 6/7/2026
Dólares CV 7000 - U$ 7000
Boleto / 7321990 / COMPRA / 1 / SPY / $ | | | | 54,00 | | | | | 54,00 | 3/7/2026 | 6/7/2026
`))

    expect(parsed.transactions).toHaveLength(1)
    expect(parsed.transactions[0]).toMatchObject({
      type: 'BUY',
      ticker: 'SPY',
      quantity: '54',
      unitPrice: '19860.00',
      date: '2026-07-03',
      currency: 'ARS',
      sourceReference: 'Boleto / 7321990 / COMPRA / 1 / SPY / $',
    })
    expect(parsed.operationGroups).toEqual([
      expect.objectContaining({
        operationReference: '7321990',
        operationType: 'BUY',
        instrument: 'SPY',
        legs: [
          expect.objectContaining({ section: 'INSTRUMENT', quantity: '54' }),
          expect.objectContaining({ section: 'CASH', currency: 'ARS' }),
          expect.objectContaining({ section: 'CASH', currency: 'USD_CABLE' }),
        ],
      }),
    ])
  })

  it('cuenta compras y ventas económicas, no filas', () => {
    const parsed = parseBalanzMonthlyAccountText(statement(`
YPF - YPFD /710
Boleto / 7321989 / COMPRA / 1 / YPFD / usd | 2,00 | | 46,99 | 93,98 | | | | | 93,98 | 3/7/2026 | 6/7/2026
PAMP - PAMP /1
Boleto / 7321988 / COMPRA / 1 / PAMP / $ | 29,00 | | 100,00 | 2.900,00 | | | | | 2.900,00 | 3/7/2026 | 6/7/2026
CEDEAR SPY - SPY /1
Boleto / 7321990 / COMPRA / 1 / SPY / $ | 54,00 | | 19.860,00 | 1.072.440,00 | | | | | 1.072.440,00 | 3/7/2026 | 6/7/2026
Boleto / 8270389 / COMPRA / 1 / SPY / $ | 75,00 | | 20.000,00 | 1.500.000,00 | | | | | 1.500.000,00 | 30/7/2026 | 31/7/2026
SMH - SMH /1
Boleto / 8270390 / COMPRA / 1 / SMH / $ | 41,00 | | 10,00 | 410,00 | | | | | 410,00 | 30/7/2026 | 31/7/2026
GD35 - GD35 /1
Boleto / 8215031 / VENTA / 1 / GD35 / $ | -1098,00 | | 10,00 | 10.980,00 | | | | | 10.980,00 | 29/7/2026 | 30/7/2026
Pesos - $
Boleto / 7321989 / COMPRA / 1 / YPFD / usd | | | | -100,00 | | | | | -100,00 | 3/7/2026 | 6/7/2026
Boleto / 7321988 / COMPRA / 1 / PAMP / $ | | | | -2.900,00 | | | | | -2.900,00 | 3/7/2026 | 6/7/2026
Boleto / 7321990 / COMPRA / 1 / SPY / $ | | | | -1.072.440,00 | | | | | -1.072.440,00 | 3/7/2026 | 6/7/2026
Boleto / 8270389 / COMPRA / 1 / SPY / $ | | | | -1.500.000,00 | | | | | -1.500.000,00 | 30/7/2026 | 31/7/2026
Boleto / 8270390 / COMPRA / 1 / SMH / $ | | | | -410,00 | | | | | -410,00 | 30/7/2026 | 31/7/2026
Boleto / 8215031 / VENTA / 1 / GD35 / $ | | | | 10.980,00 | | | | | 10.980,00 | 29/7/2026 | 30/7/2026
Boleto / 8215030 / VENTA / 1 / GD30 / $ | -919,00 | | 8,00 | 7.352,00 | | | | | 7.352,00 | 29/7/2026 | 30/7/2026
`))

    const buys = parsed.transactions.filter((movement) => movement.type === 'BUY')
    const sells = parsed.transactions.filter((movement) => movement.type === 'SELL')
    expect(buys.map((movement) => `${movement.ticker} ${movement.quantity}`).sort()).toEqual([
      'PAMP 29',
      'SMH 41',
      'SPY 54',
      'SPY 75',
      'YPFD 2',
    ])
    expect(sells.map((movement) => `${movement.ticker} ${movement.quantity}`).sort()).toEqual([
      'GD30 -919',
      'GD35 -1098',
    ])
    expect(buys).toHaveLength(5)
    expect(sells).toHaveLength(2)
  })

  it('deja el recibo de cobro como un solo aporte', () => {
    const parsed = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Recibo de Cobro / 1792564 | | | | 1.800.000,00 | | | | | 1.800.000,00 | 2/7/2026 | 2/7/2026
`))
    expect(parsed.transactions).toEqual([
      expect.objectContaining({
        type: 'CONTRIBUTION',
        date: '2026-07-02',
        netAmount: '1800000.00',
        currency: 'ARS',
      }),
    ])
  })
})

describe('conversión, renta e impuesto', () => {
  it('agrupa las dos patas de una conversión y no la trata como renta', () => {
    const parsed = parseBalanzMonthlyAccountText(statement(`
Dólares CV 7000 - U$ 7000
Movimiento Manual / Conversión CV 7.000 a CV 10.000 (dólar mep) | | | | -177,80 | | | | | -177,80 | 31/7/2026 | 4/8/2026
Movimiento Manual / Renta CV 7.000 a Cable | | | | -95,75 | | | | | -95,75 | 3/7/2026 | 3/7/2026
Dólar MEP - usd
Movimiento Manual / Conversión CV 7.000 a CV 10.000 (dólar mep) | | | | 177,80 | | | | | 177,80 | 31/7/2026 | 4/8/2026
Movimiento Manual / Renta CV 7.000 a Cable | | | | 95,75 | | | | | 95,75 | 3/7/2026 | 3/7/2026
Pesos - $
Dividendo en efectivo / KO | | | | -6,58 | | | | | -6,58 | 2/7/2026 | 2/7/2026
Renta / GD35 | | | | -17,09 | | | | | -17,09 | 10/7/2026 | 10/7/2026
Renta y Amortización / GD30 | | | | -1,87 | | | | | -1,87 | 10/7/2026 | 10/7/2026
Movimiento Manual / N/D Ret IIGG y BBPP - GGAL | | | | -11,62 | | | | | -11,62 | 6/7/2026 | 6/7/2026
`))

    const fx = parsed.transactions.filter((movement) => movement.type === 'FX_CONVERSION')
    expect(fx).toHaveLength(2)
    expect(parsed.fxOperations).toHaveLength(2)
    expect(parsed.fxOperations.every((operation) => operation.legs.length === 2)).toBe(true)
    expect(parsed.transactions.filter((movement) => movement.type === 'DIVIDEND')).toHaveLength(1)
    expect(parsed.transactions.filter((movement) => movement.type === 'INTEREST')).toHaveLength(2)
    expect(parsed.transactions.filter((movement) => movement.type === 'TAX')).toHaveLength(1)
    expect(parsed.transactions.find((movement) => movement.type === 'DIVIDEND')?.date).toBe('2026-07-02')
  })
})

describe('suscripciones de fondos', () => {
  it('matchea cada liquidación con la fila del resumen de fondos y no duplica', () => {
    const account = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Liquidación de Suscripción / 1415377 / BALANZ CAPITAL ACCIONES | | | | -1.350.000,00 | | | | | -1.350.000,00 | 3/7/2026 | 3/7/2026
Liquidación de Suscripción / 1413590 / BALANZ RETORNO TOTAL A | | | | -1.430.279,89 | | | | | -1.430.279,89 | 3/7/2026 | 3/7/2026
Dólares CV 7000 - U$ 7000
Liquidación de Suscripción / 1415377 / BALANZ CAPITAL ACCIONES | | | | 1,00 | | | | | 1,00 | 3/7/2026 | 3/7/2026
`))
    expect(account.transactions.filter((movement) => movement.type === 'FUND_SUBSCRIPTION')).toHaveLength(2)

    const enriched = enrichFundSubscriptions({
      account,
      positions: [
        {
          ticker: 'BCACCA',
          name: 'Acciones Clase A',
          rawCategory: 'Fondos',
          normalizedCategory: 'FUND',
          quantity: '1',
          guarantee: null,
          unitPrice: '1',
          marketValue: '1',
          sourceReference: 'Acciones Clase A',
        },
        {
          ticker: 'BRTA',
          name: 'Retorno Total Clase A',
          rawCategory: 'Fondos',
          normalizedCategory: 'FUND',
          quantity: '1',
          guarantee: null,
          unitPrice: '1',
          marketValue: '1',
          sourceReference: 'Retorno Total Clase A',
        },
      ],
      fundStatement: {
        broker: 'BALANZ',
        reportDate: '2026-07-31',
        warnings: [],
        funds: [
          {
            categoryName: 'Acciones',
            fundName: 'Balanz Capital Acciones',
            shareClass: 'A',
            currency: 'ARS',
            rows: [
              {
                type: 'SUBSCRIPTION',
                date: '2026-07-03',
                unitValue: '163.35',
                quantity: '8264.466250',
                amount: '1350000.00',
                sourceReference: 'Balanz Capital Acciones / Suscripción',
              },
            ],
          },
          {
            categoryName: 'Retorno Total',
            fundName: 'Balanz Retorno Total',
            shareClass: 'A',
            currency: 'ARS',
            rows: [
              {
                type: 'SUBSCRIPTION',
                date: '2026-07-03',
                unitValue: '738.18',
                quantity: '1937.575988',
                amount: '1430279.89',
                sourceReference: 'Balanz Retorno Total / Suscripción',
              },
            ],
          },
        ],
      },
    })

    expect(enriched.transactions.filter((movement) => movement.type === 'FUND_SUBSCRIPTION')).toEqual([
      expect.objectContaining({
        ticker: 'BCACCA',
        date: '2026-07-03',
        quantity: '8264.466250',
        netAmount: '1350000.00',
        currency: 'ARS',
        sourceReference: 'Liquidación de Suscripción / 1415377 / BALANZ CAPITAL ACCIONES',
      }),
      expect.objectContaining({
        ticker: 'BRTA',
        date: '2026-07-03',
        quantity: '1937.575988',
        netAmount: '1430279.89',
      }),
    ])
  })
})

describe('fecha obligatoria', () => {
  it('aborta el import si un movimiento reconocido no tiene fecha', () => {
    const parsed = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Recibo de Cobro / 1792564 | | | | 1.800.000,00 | | | | | 1.800.000,00 | |
`))
    expect(parsed.transactions).toEqual([])
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(['MISSING_DATE'])
    expect(() => assertMonthlyAccountReadable(parsed)).toThrow(ImportPeriodParsingError)
    try {
      assertMonthlyAccountReadable(parsed)
    } catch (error) {
      expect(error).toMatchObject({ unreadMovements: 1 })
    }
  })
})
