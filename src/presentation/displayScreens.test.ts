import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { PortfolioOverviewView } from '../application/portfolioOverview'
import type { PortfolioDetailView, InstrumentDetail } from '../application/portfolioDetail'
import { ImportedPeriodProvider } from '../application/ImportedPeriodProvider'
import { DashboardPage } from '../pages/DashboardPage'
import { DetailPage } from '../pages/DetailPage'
import { InstrumentPanel } from '../components/portfolio/InstrumentPanel'
import { DisplayCurrencyReference, DisplayCurrencySelector } from '../components/layout/DisplayCurrencySelector'
import { DisplayCurrencyScope } from './DisplayCurrencyProvider'
import { createDisplayPresenter, type DisplaySettings, type AvailableFxReference } from './displayMoney'

vi.mock('../application/PortfolioOverviewProvider', () => ({ usePortfolioOverview: () => ({ screen: { status: 'ready', view: overview }, retry: () => {} }) }))
vi.mock('../application/usePortfolioDetail', () => ({ usePortfolioDetail: () => ({ screen: { status: 'ready', view: detail }, retry: () => {} }) }))
vi.mock('../components/import/ImportDialogProvider', () => ({ useImportDialog: () => ({ setOpen: () => {} }) }))

const reference: AvailableFxReference = { status: 'AVAILABLE', periodId: 'july', currency: 'USD_MEP', rate: '1518.19', date: '2026-07-31', snapshotId: 'close',
  source: { kind: 'EXPLICIT_SNAPSHOT_RATE', broker: 'BALANZ', documentId: 'pdf', documentType: 'CONSOLIDATED_POSITION', originalFilename: 'closing.pdf', localPath: 'documents/closing.pdf', sha256: 'hash', parserVersion: '1', cashBalanceId: 'cash', field: 'cash_balances.fx_rate', documentField: 'Tipo de cambio: MEP' } }
const period = { id: 'july', year: 2026, month: 7, label: 'Julio 2026', status: 'COMPLETE' }
let overview: PortfolioOverviewView = {
  period, availablePeriods: [period],
  metrics: { currentPortfolioValue: '25954029', openingPortfolioValue: '23007361', portfolioValueChange: '2946668', contributions: '1800000', withdrawals: '0', netContributions: '1800000', investmentResult: '1146668', explainedResult: '1146667.136', unexplainedDifference: '0.864', reconciliationStatus: 'WARNING', performanceAttribution: 'AVAILABLE', positionAttribution: null },
  periodReturn: { method: 'MODIFIED_DIETZ', status: 'CALCULATED', decimal: '0.0464' }, historicalContributedCapital: null,
  resultBreakdown: { positionValuation: '171533.92', cashEconomicResult: '8424.216', cash: { fxValuationChange: '3077.6256', dividends: '100', interest: '20', fees: '10', taxes: '5', otherCashResult: '5346.5904' } },
  allocation: [{ id: 'CEDEAR', label: 'CEDEARs', marketValue: '1160600', weight: '0.1' }], allocationResidual: '0.864',
  evolution: [{ id: 'june', label: 'Junio', date: '2026-06-30', portfolioValue: '23007361' }, { id: 'july', label: 'Julio', date: '2026-07-31', portfolioValue: '25954029' }],
  months: [{ periodId: 'july', label: 'Julio', closingValue: '25954029', netContributions: '1800000', investmentResult: '1146668' }], contributedCapitalStatus: 'unavailable',
  importStatus: { documents: [], reconciliationStatus: 'WARNING', unexplainedDifference: '0.864', performanceAttribution: 'AVAILABLE', positionAttribution: null }, analysisNeedsRefresh: false,
}
const instrument: InstrumentDetail = { id: 'ypfd', ticker: 'YPFD', name: 'YPF', categoryId: 'STOCK', categoryLabel: 'Acciones',
  quantity: '14', openingQuantity: '12', openingQuantityDiffers: true, currentValue: '1160600', openingValue: '853500', valuationChange: '163906.4332',
  valuationStatus: 'EXPLAINED', statusLabel: 'Explicado', boughtQuantity: '2', soldQuantity: '0', subscribedQuantity: '0', quantityStatusLabel: 'Conciliada',
  acquisitionFlows: '143193.5668', disposalFlows: '0', flowNote: null,
  movements: [{ id: 'trade', date: '2026-07-03', type: 'BUY', typeLabel: 'Compra', quantity: '2', netAmount: '-94.45', currency: 'USD_MEP' }], corporateActions: [], provenance: ['Posición consolidada'],
}
const detail: PortfolioDetailView = { period, categories: [{ id: 'STOCK', label: 'Acciones', closingValue: '1160600', openingValue: '853500', valuationChange: '163906.4332', positionCount: 1 }], instruments: [instrument], totals: { investmentValue: '1160600', portfolioValue: '25954029', openingInvestmentValue: '853500', valuationChange: '163906.4332' } }

function render(node: ReactNode, settings: DisplaySettings) {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(ImportedPeriodProvider, null,
      createElement(DisplayCurrencyScope, { settings, children: node }))))
}
const usd: DisplaySettings = { currency: 'USD', referenceFx: reference }
const ars: DisplaySettings = { currency: 'ARS', referenceFx: reference }

describe('Home y Detail en una sola moneda', () => {
  it.each([ars, usd])('Home respeta $currency en cards, historial, notas y breakdowns', settings => {
    const before = structuredClone(overview)
    const html = render(createElement(DashboardPage), settings)
    const presenter = createDisplayPresenter(settings)
    expect(html).toContain(presenter.format(overview.metrics.currentPortfolioValue))
    expect(html).toContain(presenter.signed(overview.metrics.investmentResult!))
    expect(html).toContain(presenter.signed('8424.216'))
    expect(html).toContain(`Diferencia pendiente: ${presenter.format('0.864')}`)
    expect(html).toContain('+4,64%')
    if (settings.currency === 'USD') expect(html).not.toMatch(/\$[\d]/)
    else expect(html).not.toContain('USD ')
    expect(overview).toEqual(before)
  })
  it.each([ars, usd])('Detail convierte valores y categorías pero conserva quantities en $currency', settings => {
    const before = structuredClone(detail)
    const html = render(createElement(DetailPage), settings)
    const presenter = createDisplayPresenter(settings)
    expect(html).toContain(presenter.format('25954029'))
    expect(html).toContain(presenter.format('1160600'))
    expect(html).toContain(presenter.signed('163906.4332'))
    expect(html).toContain('YPFD')
    expect(html).toMatch(/>14<\//)
    if (settings.currency === 'USD') expect(html).not.toMatch(/\$[\d]/)
    else expect(html).not.toContain('USD ')
    expect(detail).toEqual(before)
  })
  it('el panel económico usa MEP de cierre y separa los datos raw en una sección técnica', () => {
    const html = render(createElement(InstrumentPanel, { instrument, onClose: () => {} }), usd)
    const principal = html.replace(/<details[\s\S]*?<\/details>/g, '')
    expect(principal).toContain(createDisplayPresenter(usd).format('143193.5668'))
    expect(principal).toContain(createDisplayPresenter(usd).signed('163906.4332'))
    expect(principal).not.toMatch(/\$[\d]/)
    expect(html).toContain('Movimientos originales · datos del documento')
    expect(html).toContain('USD MEP')
  })
  it('presenta selector global y leyenda de snapshot real', () => {
    const html = render(createElement('div', null, createElement(DisplayCurrencySelector), createElement(DisplayCurrencyReference)), usd)
    expect(html).toContain('Moneda de visualización')
    expect(html).toContain('USD MEP · cierre 31/07/2026 · $1.518,19/USD')
    const january = render(createElement(DisplayCurrencyReference), { currency: 'USD', referenceFx: { ...reference, periodId: 'january', date: '2026-01-30', rate: '1464.75' } })
    expect(january).toContain('30/01/2026')
    expect(january).not.toContain('31/01/2026')
  })
})
describe('referencia seleccionada y USD no disponible en la pantalla', () => {
  it('Agosto muestra sus valores usando 1534.51 después de Julio', () => {
    const previous = overview
    try {
      const julyHtml = render(createElement(DashboardPage), usd)
      overview = { ...previous, period: { ...period, id: 'august', month: 8, label: 'Agosto 2026' },
        metrics: { ...previous.metrics, currentPortfolioValue: '26383988', investmentResult: '179959' } }
      const august: DisplaySettings = { currency: 'USD', referenceFx: { ...reference, periodId: 'august', rate: '1534.51', date: '2026-08-31' } }
      const augustHtml = render(createElement(DashboardPage), august)
      expect(augustHtml).toContain(createDisplayPresenter(august).format('26383988'))
      expect(augustHtml).toContain(createDisplayPresenter(august).signed('179959'))
      expect(augustHtml).not.toContain(createDisplayPresenter(usd).format('26383988'))
      expect(julyHtml).toContain(createDisplayPresenter(usd).format('25954029'))
    } finally { overview = previous }
  })
  it('sin referencia mantiene ARS y deshabilita la opción USD', () => {
    const settings: DisplaySettings = { currency: 'ARS', referenceFx: null }
    const html = render(createElement('div', null, createElement(DisplayCurrencySelector), createElement(DashboardPage)), settings)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>USD<\/button>/)
    expect(html).toContain('$25.954.029,00')
    expect(html).not.toContain('USD NaN')
    expect(html).not.toContain('USD Infinity')
  })
})