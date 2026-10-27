import type { PeriodFxReference } from '../domain/periodFxReference'
import type { DisplayCurrency, DisplaySettings } from './displayMoney'

export interface CurrencyState {
  requested: DisplayCurrency
  key: string | null
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  reference: PeriodFxReference | null
}
export const initialCurrencyState: CurrencyState = { requested: 'ARS', key: null, status: 'idle', reference: null }
export type CurrencyAction =
  | { type: 'load'; key: string }
  | { type: 'resolved'; key: string; reference: PeriodFxReference }
  | { type: 'error'; key: string }
  | { type: 'select'; key: string | null; currency: DisplayCurrency }

export function displayCurrencyReducer(state: CurrencyState, action: CurrencyAction): CurrencyState {
  if (action.type === 'load') return { ...state, key: action.key, status: 'loading', reference: null }
  if (action.key !== state.key) return state
  if (action.type === 'select') {
    if (action.currency === 'USD' && (state.status !== 'ready' || state.reference?.status !== 'AVAILABLE')) return state
    return { ...state, requested: action.currency }
  }
  if (action.type === 'error') return { ...state, requested: 'ARS', reference: null, status: 'error' }
  return { ...state, reference: action.reference, status: action.reference.status === 'AVAILABLE' ? 'ready' : 'unavailable',
    requested: action.reference.status === 'AVAILABLE' ? state.requested : 'ARS' }
}

export function resolveDisplaySettings(state: CurrencyState, key: string | null, periodId: string | null): DisplaySettings & { loading: boolean; usdAvailable: boolean } {
  const current = key !== null && state.key === key
  const referenceFx = current && state.status === 'ready' && state.reference?.status === 'AVAILABLE' && state.reference.periodId === periodId ? state.reference : null
  return { currency: state.requested === 'USD' && referenceFx ? 'USD' : 'ARS', referenceFx,
    loading: key !== null && (!current || state.status === 'loading'), usdAvailable: referenceFx !== null }
}