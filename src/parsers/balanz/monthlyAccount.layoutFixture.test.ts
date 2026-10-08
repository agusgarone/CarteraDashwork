import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { PdfTextDocument, PdfTextRow } from '../text/extractPdfText'
import { parseBalanzMonthlyAccountDocument } from './monthlyAccount'

interface LayoutItem {
  page: number
  text: string
  x: number
  y: number
  width: number
}

const layout = JSON.parse(
  readFileSync(new URL('./fixtures/july2026-monthly-account.layout.json', import.meta.url), 'utf8'),
) as { items: LayoutItem[] }

describe('fixture posicional de julio 2026', () => {
  const parsed = parseBalanzMonthlyAccountDocument(documentFromLayout(layout.items))

  it('no guarda datos personales y reproduce Fecha Co. sin el PDF', () => {
    const raw = JSON.stringify(layout)
    expect(raw).not.toMatch(/comitente|cuotapartista|cuit|@|www\.balanz/i)
    expect(parsed.period).toEqual({ startDate: '2026-07-01', endDate: '2026-07-31' })
    expect(parsed.warnings.some((warning) => warning.code === 'MISSING_DATE')).toBe(false)
  })

  it('fecha las operaciones con Fecha Co. y no duplica patas del mismo boleto', () => {
    expect(find(parsed, 'CONTRIBUTION')).toMatchObject({
      date: '2026-07-02',
      netAmount: '1800000.00',
      currency: 'ARS',
    })
    expect(operation(parsed, '7321989')).toMatchObject({ instrument: 'YPFD', date: '2026-07-03' })
    expect(operation(parsed, '7321988')).toMatchObject({ instrument: 'PAMP', date: '2026-07-03' })
    expect(operation(parsed, '7321990')).toMatchObject({ instrument: 'SPY', date: '2026-07-03' })
    expect(operation(parsed, '8215031')).toMatchObject({ instrument: 'GD35', date: '2026-07-29' })
    expect(operation(parsed, '8215030')).toMatchObject({ instrument: 'GD30', date: '2026-07-29' })
    expect(operation(parsed, '8270390')).toMatchObject({ instrument: 'SMH', date: '2026-07-30' })
    expect(operation(parsed, '8270389')).toMatchObject({ instrument: 'SPY', date: '2026-07-30' })

    const buys = parsed.transactions.filter((movement) => movement.type === 'BUY')
    const sells = parsed.transactions.filter((movement) => movement.type === 'SELL')
    expect(buys.map((movement) => `${movement.ticker}:${movement.quantity}`).sort()).toEqual([
      'PAMP:29',
      'SMH:41',
      'SPY:54',
      'SPY:75',
      'YPFD:2',
    ])
    expect(sells.map((movement) => `${movement.ticker}:${movement.quantity}`).sort()).toEqual([
      'GD30:-919',
      'GD35:-1098',
    ])
    expect(buys).toHaveLength(5)
    expect(sells).toHaveLength(2)
  })

  it('clasifica suscripciones, conversión, dividendos, rentas e impuestos', () => {
    const funds = parsed.transactions.filter((movement) => movement.type === 'FUND_SUBSCRIPTION')
    expect(funds.map((movement) => movement.netAmount).sort()).toEqual(['1350000.00', '1430279.89'])
    expect(funds.every((movement) => movement.date === '2026-07-03')).toBe(true)
    expect(parsed.transactions.filter((movement) => movement.type === 'FX_CONVERSION')).toHaveLength(2)
    expect(parsed.fxOperations).toHaveLength(2)
    expect(parsed.fxOperations.every((operation) => operation.legs.length === 2)).toBe(true)
    expect(parsed.transactions.filter((movement) => movement.type === 'DIVIDEND')).toHaveLength(3)
    expect(parsed.transactions.filter((movement) => movement.type === 'INTEREST')).toHaveLength(4)
    expect(parsed.transactions.filter((movement) => movement.type === 'TAX')).toHaveLength(1)
    expect(parsed.warnings).toEqual([])
    expect(parsed.operationGroups.filter((group) => group.operationType === 'KNOWN_NON_ECONOMIC')).toHaveLength(2)
  })
})

function documentFromLayout(items: readonly LayoutItem[]): PdfTextDocument {
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

function find(
  parsed: ReturnType<typeof parseBalanzMonthlyAccountDocument>,
  type: string,
) {
  return parsed.transactions.find((movement) => movement.type === type)
}

function operation(parsed: ReturnType<typeof parseBalanzMonthlyAccountDocument>, reference: string) {
  return parsed.operationGroups.find((group) => group.operationReference === reference)
}
