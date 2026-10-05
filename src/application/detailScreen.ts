import type { PortfolioDetailView } from './portfolioDetail'

export type DetailScreen =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: PortfolioDetailView }

export type DetailScreenAction =
  | { type: 'load' }
  | { type: 'empty' }
  | { type: 'error'; message: string }
  | { type: 'ready'; view: PortfolioDetailView }

export const initialDetailScreen: DetailScreen = { status: 'loading' }

export function detailScreenReducer(_state: DetailScreen, action: DetailScreenAction): DetailScreen {
  switch (action.type) {
    case 'load':
      return { status: 'loading' }
    case 'empty':
      return { status: 'empty' }
    case 'error':
      return { status: 'error', message: action.message }
    case 'ready':
      return { status: 'ready', view: action.view }
  }
}
