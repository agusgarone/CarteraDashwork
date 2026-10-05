import type { PortfolioOverviewView } from './portfolioOverview'

export type OverviewScreen =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: PortfolioOverviewView }

export type OverviewScreenAction =
  | { type: 'load' }
  | { type: 'empty' }
  | { type: 'error'; message: string }
  | { type: 'ready'; view: PortfolioOverviewView }

export const initialOverviewScreen: OverviewScreen = { status: 'loading' }

export function overviewScreenReducer(
  _state: OverviewScreen,
  action: OverviewScreenAction,
): OverviewScreen {
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
