import type { EntityId } from './common'

export type DocumentType =
  | 'CONSOLIDATED_POSITION'
  | 'PERIOD_RESULTS'
  | 'MONTHLY_ACCOUNT'
  | 'MONTHLY_FUND_STATEMENT'
  | 'OTHER'

export type DocumentProcessingStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'ERROR'

/**
 * Archivo original persistido (PDF o Excel) asociado a un período.
 *
 * No es el ImportDocument de src/types/import.ts. Ese type describe el
 * estado del flujo de importación en la UI. PortfolioDocument es el
 * archivo realmente guardado.
 */
export interface PortfolioDocument {
  id: EntityId
  periodId: EntityId

  type: DocumentType

  originalFilename: string
  localPath: string
  sha256: string

  processingStatus: DocumentProcessingStatus
  parserVersion: string | null

  createdAt: string
}
