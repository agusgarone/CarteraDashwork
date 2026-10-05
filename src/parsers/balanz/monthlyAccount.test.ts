/// <reference types="node" />

import { readFileSync } from 'node:fs'
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { UnreadableDocumentError } from '../errors/parserErrors'
import { parseBalanzMonthlyAccountText } from './monthlyAccount'
import { extractPdfText } from '../text/extractPdfText'
import { parseArgentineNumber, parseBalanzDate } from '../text/argentinianFormat'

const sanitizedAugust = readFileSync(
  new URL('./fixtures/public/august2026-sanitized.txt', import.meta.url),
  'utf8',
)

const COLUMNS =
  'Descripción | Cant. VN | Saldo | Precio | Bruto | Arancel Impor. | IVA Impor. | Derech Impor. | IVA | Neto | Fecha Co. | Fecha Li.'

function statement(body: string): string {
  return `Cuenta Corriente por Concertación del 1/8/2026 al 31/8/2026
${COLUMNS}
${body}`
}

describe('formato argentino', () => {
  it('lee miles con punto y decimales con coma', () => {
    expect(parseArgentineNumber('1.250.000,00')?.toFixed(2)).toBe('1250000.00')
    expect(parseArgentineNumber('188,58')?.toFixed(2)).toBe('188.58')
    expect(parseArgentineNumber('-1.000.000,00')?.toFixed(2)).toBe('-1000000.00')
  })

  it('normaliza una fecha de Balanz con o sin ceros', () => {
    expect(parseBalanzDate('03/08/2026')).toBe('2026-08-03')
    expect(parseBalanzDate('4/8/2026')).toBe('2026-08-04')
    expect(parseBalanzDate('14/8/2026')).toBe('2026-08-14')
    expect(parseBalanzDate('31/02/2026')).toBeNull()
  })
})

describe('clasificación del resumen mensual', () => {
  it('toma el neto del recibo de cobro y no el saldo corrido', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Recibo de Cobro / 2099659 | | 1.267.506,96 | 0,0000000000 | 1.250.000,00 | | | 0,00 | | 1.250.000,00 | 3/8/2026 | 3/8/2026
`))

    expect(result.transactions).toEqual([
      expect.objectContaining({
        type: 'CONTRIBUTION',
        currency: 'ARS',
        netAmount: '1250000.00',
        grossAmount: '1250000.00',
        sourceReference: 'Recibo de Cobro / 2099659',
      }),
    ])
  })

  it('reconoce un comprobante de pago como retiro y guarda el importe positivo', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Comprobante de Pago / 1937866 | | 267.659,33 | 0,0000000000 | -1.000.000,00 | | | 0,00 | | -1.000.000,00 | 18/8/2026 | 18/8/2026
`))

    expect(result.transactions[0]).toMatchObject({
      type: 'WITHDRAWAL',
      currency: 'ARS',
      netAmount: '1000000.00',
      grossAmount: '1000000.00',
    })
  })

  it('reconoce un dividendo en dólar cable y no inventa el tipo de cambio', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Dólares CV 7000 - U$ 7000
Dividendo en efectivo / SPY | | 1,92 | 0,0000000000 | 1,93 | 0,01 | | 0,00 | | 1,92 | 3/8/2026 | 3/8/2026
`))

    expect(result.transactions[0]).toMatchObject({
      type: 'DIVIDEND',
      ticker: 'SPY',
      currency: 'USD_CABLE',
      grossAmount: '1.93',
      netAmount: '1.92',
      fees: '0.01',
      taxes: null,
      fxRate: null,
    })
  })

  it('conserva un tipo de cambio solo cuando el cuadro trae esa columna', () => {
    const result = parseBalanzMonthlyAccountText(`Cuenta Corriente por Concertación del 1/8/2026 al 31/8/2026
Descripción | Neto | Fecha Co. | Fecha Li. | Tipo de cambio
Dólares CV 7000 - U$ 7000
Dividendo en efectivo / SPY | 1,92 | 3/8/2026 | 3/8/2026 | 1.234,50
`)

    expect(result.transactions[0]?.fxRate).toBe('1234.50')
  })

  it('reconoce una retención como impuesto sin inventar el instrumento', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Retención IIGG | | | | | | | | | 1.500,00 | 20/8/2026 | 20/8/2026
`))

    expect(result.transactions[0]).toMatchObject({
      type: 'TAX',
      ticker: null,
      currency: 'ARS',
      netAmount: '1500.00',
    })
  })

  it('extrae una compra con cantidad, precio y costos de la fila', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Compra / GGAL | 10 | | 1.500,00 | 15.000,00 | 80,00 | | | 20,00 | 15.100,00 | 10/8/2026 | 10/8/2026
`))

    expect(result.transactions[0]).toMatchObject({
      type: 'BUY',
      ticker: 'GGAL',
      quantity: '10',
      unitPrice: '1500.00',
      grossAmount: '15000.00',
      netAmount: '15100.00',
      fees: '80.00',
      taxes: '20.00',
      fxRate: null,
    })
    expect(result.corporateActions).toEqual([])
  })

  it('extrae una venta', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Venta / PAMP | 5 | | 2.000,00 | | | | | | 10.000,00 | 11/8/2026 | 11/8/2026
`))

    expect(result.transactions[0]).toMatchObject({
      type: 'SELL',
      ticker: 'PAMP',
      quantity: '5',
      netAmount: '10000.00',
    })
  })

  it('registra el dividendo en acciones de YPFD y no lo trata como compra', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
YPF S.A. ESCRIT. "D" 1 VOTO - YPFD /710
Saldo Anterior | 14,00 | | 0,0000000000 | | | | | | | |
Dividendo en acciones / YPFD | 126,00 | 140,00 | 7840,0000000000 | | | | 0,00 | | | 4/8/2026 | 4/8/2026
`))

    expect(result.transactions.some((movement) => movement.type === 'BUY')).toBe(false)
    expect(result.transactions.some((movement) => movement.ticker === 'YPFD')).toBe(false)
    expect(result.corporateActions).toEqual([
      {
        date: '2026-08-04',
        type: 'STOCK_DIVIDEND',
        ticker: 'YPFD',
        quantityBefore: '14',
        quantityChange: '126',
        quantityAfter: '140',
        ratio: null,
        description: 'Dividendo en acciones / YPFD',
        sourceReference: 'Dividendo en acciones / YPFD',
      },
    ])
  })

  it('avisa un movimiento desconocido y lo deja como OTHER', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Ajuste de cuenta / 999 | | | | 10,00 | | | | | 10,00 | 5/8/2026 | 5/8/2026
`))

    expect(result.transactions[0]?.type).toBe('OTHER')
    expect(result.warnings.map((item) => item.code)).toContain('UNKNOWN_MOVEMENT')
  })

  it('no crea un movimiento si la moneda no se reconoce', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Dólar Blue
Dividendo en efectivo / SPY | | | | 1,00 | | | | | 1,00 | 5/8/2026 | 5/8/2026
`))

    expect(result.transactions).toEqual([])
    expect(result.warnings.map((item) => item.code)).toContain('UNKNOWN_CURRENCY')
  })

  it('no crea un movimiento sin importe', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Dividendo en efectivo / SPY | | | | | | | | | | 5/8/2026 | 5/8/2026
`))

    expect(result.transactions).toEqual([])
    expect(result.warnings.map((item) => item.code)).toContain('MISSING_AMOUNT')
  })

  it('no convierte saldos ni el pie en movimientos', () => {
    const result = parseBalanzMonthlyAccountText(statement(`
Pesos - $
Saldo Anterior | | | 0,0000000000 | | | | | | 17.658,61 |
Saldo al 31/08/2026 | | | 0,0000000000 | | | | | | 267.659,33 |
BALANZ CAPITAL VALORES SAU www.balanz.com
`))

    expect(result.transactions).toEqual([])
    expect(result.warnings).toEqual([])
  })
})

describe('fixture sanitizado agosto 2026', () => {
  const result = parseBalanzMonthlyAccountText(sanitizedAugust)

  it('produce los movimientos del PDF y deja el tipo de cambio en null', () => {
    expect(result.period).toEqual({ startDate: '2026-08-01', endDate: '2026-08-31' })
    expect(result.warnings).toEqual([])
    expect(result.transactions).toEqual([
      movement('2026-08-03', 'DIVIDEND', 'SPY', 'ARS', '0.00', '-144.17', '0.01'),
      movement('2026-08-03', 'DIVIDEND', 'JPM', 'ARS', '0.00', '-7.48', '0.00'),
      movement('2026-08-03', 'CONTRIBUTION', null, 'ARS', '1250000.00', '1250000.00', '0.00'),
      movement('2026-08-06', 'DIVIDEND', 'GGAL', 'ARS', '166.02', '165.60', '0.17'),
      movement('2026-08-06', 'TAX', 'GGAL', 'ARS', '-11.62', '-11.62', '0.00'),
      movement('2026-08-14', 'DIVIDEND', 'AAPL', 'ARS', '0.00', '-1.61', '0.00'),
      movement('2026-08-18', 'WITHDRAWAL', null, 'ARS', '1000000.00', '1000000.00', '0.00'),
      movement('2026-08-03', 'DIVIDEND', 'SPY', 'USD_CABLE', '1.93', '1.92', '0.01'),
      movement('2026-08-03', 'DIVIDEND', 'JPM', 'USD_CABLE', '1.17', '1.17', '0.00'),
      movement('2026-08-14', 'DIVIDEND', 'AAPL', 'USD_CABLE', '0.25', '0.25', '0.00'),
    ])
    expect(result.transactions.map((item) => item.sourceReference)).toEqual([
      'Dividendo en efectivo / SPY',
      'Dividendo en efectivo / JPM',
      'Recibo de Cobro / 2099659',
      'Dividendo en efectivo / GGAL',
      'Movimiento Manual / N/D Ret IIGG y BBPP - GGAL',
      'Dividendo en efectivo / AAPL',
      'Comprobante de Pago / 1937866',
      'Dividendo en efectivo / SPY',
      'Dividendo en efectivo / JPM',
      'Dividendo en efectivo / AAPL',
    ])

    const cableDividends = result.transactions
      .filter((item) => item.type === 'DIVIDEND' && item.currency === 'USD_CABLE')
      .reduce((total, item) => total.plus(item.netAmount ?? '0'), new Decimal(0))
    expect(cableDividends.toFixed(2)).toBe('3.34')
    expect(result.transactions.some((item) => item.netAmount === '3.34' || item.netAmount === '3.09')).toBe(false)
    expect(result.transactions.some((item) => item.netAmount === '1267506.96')).toBe(false)
  })

  it('registra YPFD como dividendo en acciones', () => {
    expect(result.transactions.some((item) => item.type === 'BUY' || item.ticker === 'YPFD')).toBe(false)
    expect(result.corporateActions).toEqual([
      {
        date: '2026-08-04',
        type: 'STOCK_DIVIDEND',
        ticker: 'YPFD',
        quantityBefore: '14',
        quantityChange: '126',
        quantityAfter: '140',
        ratio: null,
        description: 'Dividendo en acciones / YPFD',
        sourceReference: 'Dividendo en acciones / YPFD',
      },
    ])
  })
})

describe('extracción de texto PDF', () => {
  it('lee el texto de un PDF y no usa OCR', async () => {
    const text = await extractPdfText(minimalPdf('Resumen mensual comitente'))
    expect(text).toContain('Resumen mensual comitente')
  })

  it('falla cuando el PDF no tiene texto extraíble', async () => {
    await expect(extractPdfText(minimalPdf(null))).rejects.toBeInstanceOf(UnreadableDocumentError)
  })
})

function movement(
  date: string,
  type: string,
  ticker: string | null,
  currency: string,
  grossAmount: string,
  netAmount: string,
  fees: string,
) {
  return {
    date,
    type,
    ticker,
    quantity: null,
    unitPrice: null,
    grossAmount,
    netAmount,
    fees,
    taxes: null,
    currency,
    fxRate: null,
    sourceReference: expect.any(String),
  }
}

function minimalPdf(text: string | null): Uint8Array {
  const stream = text === null ? '' : `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`
  const source = `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length ${stream.length} >>stream
${stream}
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
trailer<< /Root 1 0 R >>
%%EOF`
  return new TextEncoder().encode(source)
}
