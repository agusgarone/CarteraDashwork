import type { EntityId } from './common'
import type { CurrencyCode } from './currency'

export type InstrumentCategory =
  | 'CEDEAR'
  | 'STOCK'
  | 'CORPORATE_BOND'
  | 'BOND'
  | 'FUND'
  | 'OTHER'

/**
 * Identidad de un instrumento.
 *
 * No incluye quantity, currentValue, investedCapital, result,
 * returnPercentage ni income. Esos datos dependen de una posición,
 * una fecha o un período: la cantidad y el valor de mercado viven en
 * Position; el rendimiento lo calcula después el PortfolioEngine.
 */
export interface Instrument {
  id: EntityId

  ticker: string
  name: string | null

  category: InstrumentCategory

  currency: CurrencyCode

  brokerIdentifier: string | null

  createdAt: string
}
