export type CurrencyCode = 'ARS' | 'USD_MEP' | 'USD_CABLE'

export type PeriodPreset = 'now' | '3m' | '6m' | 'ytd' | '1y' | 'custom'

export type MonthStatus = 'complete' | 'missing'

export interface Period {
  id: string
  label: string
  startDate: string
  endDate: string
}

export interface PeriodSelection {
  preset: PeriodPreset
  startMonthId: string
  endMonthId: string
}

export interface CashBalance {
  id: string
  label: string
  amount: number
  currency: CurrencyCode
  /** Stored for a future FX engine. The UI does not convert amounts. */
  fxRate: number | null
}

export interface Category {
  id: string
  name: string
  currentValue: number
  investedCapital: number
  /** Position result: current value minus invested capital. Not the period result. */
  result: number
  returnPercentage: number
  weight: number
  /** Result attributed to this category inside the selected period. */
  periodResult: number
}

export interface PortfolioSnapshot {
  date: string
  totalValue: number
  investedCapital: number
  categories: Category[]
  cashBalances: CashBalance[]
}

export interface PortfolioPeriodSummary {
  startValue: number
  endValue: number
  contributions: number
  withdrawals: number
  netContributions: number
  investmentResult: number
  returnPercentage: number
  /**
   * endValue - (startValue + netContributions + investmentResult).
   * Zero when loaded months close. Kept visible when they do not.
   */
  unexplainedDifference: number
}

export interface PerformanceBreakdown {
  marketChange: number
  dividends: number
  interest: number
  fees: number
  taxes: number
  other: number
}

export interface MonthSnapshot {
  id: string
  label: string
  shortLabel: string
  startDate: string
  endDate: string
  status: MonthStatus
  startValue: number | null
  endValue: number | null
  contributions: number | null
  withdrawals: number | null
  netContributions: number | null
  investmentResult: number | null
  investedCapitalEnd: number | null
  returnPercentage: number | null
}

export interface EvolutionPoint {
  id: string
  label: string
  totalValue: number | null
  investedCapital: number | null
}

export interface Instrument {
  id: string
  ticker: string
  name: string
  categoryId: string
  quantity: number
  quantityUnit: string
  currentValue: number
  investedCapital: number
  result: number
  returnPercentage: number
  /** Period income. Null when there was none, so the UI can show an em dash. */
  income: number | null
}

export interface InstrumentResultOrigin {
  marketChange: number
  dividends: number
  interest: number
  feesAndTaxes: number
}
