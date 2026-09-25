export type DocumentStatus =
  | 'pending'
  | 'uploaded'
  | 'processing'
  | 'processed'
  | 'error'

export type ReconciliationStatus = 'pending' | 'ok' | 'difference'

export interface ImportDocument {
  id: string
  label: string
  description: string
  status: DocumentStatus
  fileName: string | null
  errorMessage: string | null
}

export interface ImportPeriod {
  month: string
  monthLabel: string
  status: 'draft' | 'processing' | 'processed' | 'error'
  documents: ImportDocument[]
  reconciliationStatus: ReconciliationStatus
  reconciliationDifference: number | null
}

export interface ImportResultSummary {
  documentsProcessed: number
  instrumentsFound: number
  operationsFound: number
  dividendsFound: number
  flowsIdentified: boolean
}
