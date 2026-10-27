import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { convertForDisplay, createDisplayPresenter, displayReferenceLegend, formatDisplayAmount, formatDisplayAxis, projectChartValues, type AvailableFxReference } from './displayMoney'
import { displayCurrencyReducer, initialCurrencyState, resolveDisplaySettings } from './displayCurrencyState'
import { formatReturnPercent } from '../utils/formatPercentage'

function reference(periodId = 'july', rate = '1518.19', date = '2026-07-31'): AvailableFxReference {
  return { status: 'AVAILABLE', periodId, currency: 'USD_MEP', rate, date, snapshotId: periodId,
    source: { kind: 'EXPLICIT_SNAPSHOT_RATE', broker: 'BALANZ', documentId: 'pdf', documentType: 'CONSOLIDATED_POSITION',
      originalFilename: 'closing.pdf', localPath: 'documents/closing.pdf', sha256: 'hash', parserVersion: '1', cashBalanceId: 'cash',
      field: 'cash_balances.fx_rate', documentField: 'Tipo de cambio: MEP' } }
}

describe('conversión monetaria exclusivamente para presentación', () => {
  it('ARS conserva exactamente el DecimalString original', () => {
    expect(convertForDisplay({ amountArs: '100.0040', currency: 'ARS' })).toBe('100.0040')
  })
  it('convierte USD con Decimal sin perder enteros mayores al rango seguro de number', () => {
    expect(convertForDisplay({ amountArs: '9007199254740993', currency: 'USD', usdMepRate: '3' })).toBe('3002399751580331')
  })
  it('no modifica la configuración Decimal usada por las fórmulas financieras', () => {
    const precision = Decimal.precision
    convertForDisplay({ amountArs: '1', currency: 'USD', usdMepRate: '3' })
    expect(Decimal.precision).toBe(precision)
  })
  it('conserva negativos y cero', () => {
    expect(convertForDisplay({ amountArs: '-3', currency: 'USD', usdMepRate: '2' })).toBe('-1.5')
    expect(convertForDisplay({ amountArs: '0', currency: 'USD', usdMepRate: '2' })).toBe('0')
  })
  it('no produce USD NaN, Infinity ni un fallback cuando falta referencia', () => {
    expect(() => convertForDisplay({ amountArs: '10', currency: 'USD' })).toThrow(/referencia MEP válida/)
    expect(() => convertForDisplay({ amountArs: '10', currency: 'USD', usdMepRate: '0' })).toThrow(/referencia MEP válida/)
  })
  it.each([
    ['july', '1518.19', '2026-07-31', '25954029', '1146668'],
    ['august', '1534.51', '2026-08-31', '26383988', '179959'],
  ])('%s calcula patrimonio y resultado esperado con Decimal', (id, rate, date, closing, result) => {
    const settings = { currency: 'USD' as const, referenceFx: reference(id, rate, date) }
    const highPrecision = Decimal.clone({ precision: 40 })
    for (const value of [closing, result]) {
      expect(convertForDisplay({ amountArs: value, currency: 'USD', usdMepRate: rate })).toBe(new highPrecision(value).div(rate).toFixed())
      expect(formatDisplayAmount(value, settings)).toContain(new highPrecision(value).div(rate).toFixed(2).split('.')[1])
    }
  })
  it('usa el MEP de display, no el transaction FX de YPFD', () => {
    const resultArs = '163906.4332'
    expect(convertForDisplay({ amountArs: resultArs, currency: 'USD', usdMepRate: '1518.19' }))
      .not.toBe(convertForDisplay({ amountArs: resultArs, currency: 'USD', usdMepRate: '1523.66' }))
  })
})

describe('formato y gráficos', () => {
  it('distingue ARS de USD y conserva signos', () => {
    expect(formatDisplayAmount('1000', { currency: 'ARS', referenceFx: null })).toBe('$1.000,00')
    expect(formatDisplayAmount('-1000', { currency: 'USD', referenceFx: reference('x', '2') })).toBe('-USD 500,00')
    expect(formatDisplayAmount('1000', { currency: 'USD', referenceFx: reference('x', '2') }, { signed: true })).toBe('+USD 500,00')
  })
  it('la diferencia pequeña conserva su valor y precisión en tooltip', () => {
    const presenter = createDisplayPresenter({ currency: 'USD', referenceFx: reference('august', '1534.51', '2026-08-31') })
    expect(presenter.signed('0.8640')).toBe('+USD 0,00')
    expect(presenter.precise('0.8640')).not.toBe('+USD 0,00000000')
    expect(new Decimal(presenter.toDisplayValue('0.8640')).gt(0)).toBe(true)
  })
  it('Enero usa la fecha real 30/01 en la leyenda', () => {
    expect(displayReferenceLegend(reference('january', '1464.75', '2026-01-30'))).toBe('USD MEP · cierre 30/01/2026 · $1.464,75/USD')
  })
  it('convierte todos los puntos con una sola referencia y no muta el chart original', () => {
    const points = [{ month: 'June', amount: '3000' }, { month: 'July', amount: '6000' }]
    const snapshot = structuredClone(points)
    const data = projectChartValues(points, point => point.amount, { currency: 'USD', referenceFx: reference('july', '3') })
    expect(data.map(point => point.displayValue)).toEqual(['1000', '2000'])
    expect(points).toEqual(snapshot)
    expect(formatDisplayAxis(2000, 'USD')).toBe('USD 2 mil')
  })
  it('la moneda no interviene en el porcentaje', () => {
    const percentage = '0.0464'
    const before = formatReturnPercent(percentage)
    formatDisplayAmount('1146668', { currency: 'USD', referenceFx: reference() })
    expect(formatReturnPercent(percentage)).toBe(before)
  })
})

describe('cambio de período y referencia obsoleta', () => {
  function julyInUsd() {
    let state = displayCurrencyReducer(initialCurrencyState, { type: 'load', key: 'july:1' })
    state = displayCurrencyReducer(state, { type: 'resolved', key: 'july:1', reference: reference() })
    return displayCurrencyReducer(state, { type: 'select', key: 'july:1', currency: 'USD' })
  }
  it('empieza en ARS y no habilita USD sin referencia', () => {
    expect(initialCurrencyState.requested).toBe('ARS')
    expect(displayCurrencyReducer(initialCurrencyState, { type: 'select', key: null, currency: 'USD' })).toEqual(initialCurrencyState)
  })
  it('invalida Julio inmediatamente al seleccionar Agosto, antes del efecto de carga', () => {
    const state = julyInUsd()
    expect(resolveDisplaySettings(state, 'august:2', 'august')).toMatchObject({ currency: 'ARS', referenceFx: null, loading: true })
  })
  it('mantiene USD y cambia de 1518.19 a 1534.51; ignora respuestas tardías', () => {
    let state = displayCurrencyReducer(julyInUsd(), { type: 'load', key: 'august:2' })
    state = displayCurrencyReducer(state, { type: 'resolved', key: 'august:2', reference: reference('august', '1534.51', '2026-08-31') })
    const next = displayCurrencyReducer(state, { type: 'resolved', key: 'july:1', reference: reference() })
    expect(next).toEqual(state)
    expect(resolveDisplaySettings(next, 'august:2', 'august')).toMatchObject({ currency: 'USD', referenceFx: { rate: '1534.51' } })
  })
  it('cambia visualmente a ARS si el siguiente período no tiene MEP', () => {
    let state = displayCurrencyReducer(julyInUsd(), { type: 'load', key: 'missing:2' })
    state = displayCurrencyReducer(state, { type: 'resolved', key: 'missing:2', reference: { status: 'UNAVAILABLE', periodId: 'missing', currency: 'USD_MEP', reason: 'MISSING_USD_MEP_BALANCE' } })
    expect(state.requested).toBe('ARS')
    expect(resolveDisplaySettings(state, 'missing:2', 'missing')).toMatchObject({ currency: 'ARS', referenceFx: null, usdAvailable: false })
  })
})