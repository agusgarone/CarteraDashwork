import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

export interface SelectedImportPeriod {
  id: string
  year: number
  month: number
}

interface ImportedPeriodContextValue {
  period: SelectedImportPeriod | null
  revision: number
  selectImportedPeriod: (period: SelectedImportPeriod) => void
}

const ImportedPeriodContext = createContext<ImportedPeriodContextValue | null>(null)

export function ImportedPeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<SelectedImportPeriod | null>(null)
  const [revision, setRevision] = useState(0)

  function selectImportedPeriod(next: SelectedImportPeriod) {
    setPeriod(next)
    setRevision((value) => value + 1)
  }

  return (
    <ImportedPeriodContext.Provider value={{ period, revision, selectImportedPeriod }}>
      {children}
    </ImportedPeriodContext.Provider>
  )
}

export function useImportedPeriod() {
  const context = useContext(ImportedPeriodContext)
  if (!context) {
    throw new Error('useImportedPeriod debe usarse dentro de ImportedPeriodProvider.')
  }
  return context
}
