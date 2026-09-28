import type { EntityId } from './common'

export type PeriodStatus = 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'ERROR'

/**
 * Período mensual importado.
 * En persistencia, (portfolioId, year, month) debe ser único.
 */
export interface PortfolioPeriod {
  id: EntityId
  portfolioId: EntityId

  year: number
  month: number

  status: PeriodStatus

  createdAt: string
  completedAt: string | null
}
