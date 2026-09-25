import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

interface ImportDialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const ImportDialogContext = createContext<ImportDialogContextValue | null>(null)

export function ImportDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <ImportDialogContext.Provider value={{ open, setOpen }}>
      {children}
    </ImportDialogContext.Provider>
  )
}

export function useImportDialog() {
  const context = useContext(ImportDialogContext)
  if (!context) {
    throw new Error('useImportDialog debe usarse dentro de ImportDialogProvider.')
  }
  return context
}
