import { describe, expect, it } from 'vitest'
import type { InstrumentDetail } from './portfolioDetail'
import { visibleInstruments } from './portfolioDetail'
import { detailScreenReducer, initialDetailScreen } from './detailScreen'

function instrument(partial: Pick<InstrumentDetail, 'id' | 'ticker' | 'name' | 'categoryId' | 'currentValue' | 'valuationChange'>): InstrumentDetail {
  return {
    categoryLabel: partial.categoryId,
    quantity: '1',
    openingQuantity: '1',
    openingQuantityDiffers: false,
    openingValue: null,
    valuationStatus: 'EXPLAINED',
    statusLabel: 'Explicado',
    movements: [],
    corporateActions: [],
    provenance: [],
    ...partial,
  }
}

const rows = [
  instrument({ id: 'meta', ticker: 'META', name: 'Meta Platforms', categoryId: 'CEDEAR', currentValue: '496340', valuationChange: '21320.00' }),
  instrument({ id: 'ypfd', ticker: 'YPFD', name: 'YPF', categoryId: 'STOCK', currentValue: '1155700', valuationChange: '-4900.00' }),
  instrument({ id: 'fund', ticker: 'BCACCA', name: null, categoryId: 'FUND', currentValue: '2287732.22', valuationChange: null }),
]

describe('visibleInstruments', () => {
  it('filtra por categoría sin recalcular importes', () => {
    const cedears = visibleInstruments(rows, { categoryId: 'CEDEAR', query: '', sort: 'currentValue' })
    expect(cedears.map((row) => row.ticker)).toEqual(['META'])
    expect(cedears[0]?.valuationChange).toBe('21320.00')
  })

  it('busca por ticker o nombre', () => {
    expect(visibleInstruments(rows, { categoryId: 'ALL', query: 'ypf', sort: 'currentValue' }).map((row) => row.ticker)).toEqual(['YPFD'])
    expect(visibleInstruments(rows, { categoryId: 'ALL', query: 'meta', sort: 'currentValue' }).map((row) => row.ticker)).toEqual(['META'])
  })

  it('ordena por valor actual y deja la variación nula al final', () => {
    const byValue = visibleInstruments(rows, { categoryId: 'ALL', query: '', sort: 'currentValue' })
    expect(byValue.map((row) => row.ticker)).toEqual(['BCACCA', 'YPFD', 'META'])
    const byChange = visibleInstruments(rows, { categoryId: 'ALL', query: '', sort: 'valuationChange' })
    expect(byChange.map((row) => row.ticker)).toEqual(['META', 'YPFD', 'BCACCA'])
  })
})

describe('detailScreenReducer', () => {
  it('empieza en loading y un error no conserva instrumentos', () => {
    expect(initialDetailScreen).toEqual({ status: 'loading' })
    const failed = detailScreenReducer(initialDetailScreen, {
      type: 'error',
      message: 'No se pudo leer el detalle.',
    })
    expect(failed).toEqual({ status: 'error', message: 'No se pudo leer el detalle.' })
    expect(failed).not.toHaveProperty('view')
  })

  it('una base vacía no cae en números de ejemplo', () => {
    expect(detailScreenReducer(initialDetailScreen, { type: 'empty' })).toEqual({ status: 'empty' })
  })
})
