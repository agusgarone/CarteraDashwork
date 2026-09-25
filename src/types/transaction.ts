import type { CurrencyCode } from '@/types/portfolio'

/**
 * Quantity changes are not assumed to be buys.
 * Corporate actions (split, reverse split, stock dividend, ratio change)
 * have their own type so a future engine can record them explicitly.
 */
export type TransactionType =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'interest'
  | 'fee'
  | 'tax'
  | 'contribution'
  | 'withdrawal'
  | 'corporate_action'

export interface Transaction {
  id: string
  date: string
  instrumentId: string | null
  type: TransactionType
  quantity: number | null
  price: number | null
  currency: CurrencyCode
  grossAmount: number | null
  netAmount: number | null
  fees: number
  taxes: number
  fxRate: number | null
}
