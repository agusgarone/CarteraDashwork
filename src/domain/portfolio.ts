import type { EntityId } from './common'
import type { CurrencyCode } from './currency'

/**
 * Cartera persistida.
 * No incluye patrimonio ni rendimiento: esos valores los calcula el motor.
 */
export interface Portfolio {
  id: EntityId
  name: string
  broker: string
  baseCurrency: CurrencyCode
  createdAt: string
}
