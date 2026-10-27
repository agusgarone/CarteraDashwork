import { createContext, useContext, useEffect, useMemo, useReducer } from 'react'
import type { ReactNode } from 'react'
import { useImportedPeriod } from '../application/ImportedPeriodProvider'
import { usePortfolioOverview } from '../application/PortfolioOverviewProvider'
import { getPeriodUsdMepReference } from '../services/periodFxReferenceService'
import { createDisplayPresenter, type DisplayCurrency, type DisplaySettings } from './displayMoney'
import { displayCurrencyReducer, initialCurrencyState, resolveDisplaySettings } from './displayCurrencyState'

const unavailableMessage = 'USD no disponible para este período porque no hay una cotización MEP válida en el snapshot de cierre.'
const defaultContext = {
  ...createDisplayPresenter({ currency: 'ARS', referenceFx: null }),
  periodId: null as string | null, requestedCurrency: 'ARS' as DisplayCurrency,
  loading: false, usdAvailable: false, message: null as string | null,
  setCurrency: (_currency: DisplayCurrency) => {},
}
const DisplayCurrencyContext = createContext(defaultContext)

/** Controlled presentation scope, also usable by previews and component tests. */
export function DisplayCurrencyScope({ settings, children }: { settings: DisplaySettings; children: ReactNode }) {
  const value = { ...defaultContext, ...createDisplayPresenter(settings), requestedCurrency: settings.currency,
    periodId: settings.referenceFx?.periodId ?? null, usdAvailable: settings.referenceFx !== null }
  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>
}

export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const { period, revision } = useImportedPeriod()
  const { screen } = usePortfolioOverview()
  const periodId = period?.id ?? (screen.status === 'ready' ? screen.view.period.id : null)
  const key = periodId ? `${periodId}:${revision}` : null
  const [state, dispatch] = useReducer(displayCurrencyReducer, initialCurrencyState)
  useEffect(() => {
    if (!key || !periodId) return
    let cancelled = false
    dispatch({ type: 'load', key })
    void getPeriodUsdMepReference(periodId).then(reference => {
      if (!cancelled) dispatch({ type: 'resolved', key, reference })
    }).catch(() => { if (!cancelled) dispatch({ type: 'error', key }) })
    return () => { cancelled = true }
  }, [key, periodId])
  const value = useMemo(() => {
    const settings = resolveDisplaySettings(state, key, periodId)
    const current = state.key === key
    const message = current && state.status === 'error' ? 'No se pudo consultar la referencia USD MEP. Los importes se muestran en ARS.'
      : current && state.status === 'unavailable' ? unavailableMessage : null
    return { ...createDisplayPresenter(settings), periodId, requestedCurrency: state.requested,
      loading: settings.loading, usdAvailable: settings.usdAvailable, message,
      setCurrency: (currency: DisplayCurrency) => dispatch({ type: 'select', key, currency }) }
  }, [state, key, periodId])
  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>
}

export function useDisplayCurrency() { return useContext(DisplayCurrencyContext) }