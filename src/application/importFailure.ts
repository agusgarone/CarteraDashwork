import { ImportConflictError, ImportPeriodValidationError } from '../import/importPeriodErrors'

export interface ImportFailureView {
  headline: string
  detail: string | null
}

export function describeImportFailure(error: unknown): ImportFailureView {
  if (error instanceof ImportConflictError) {
    const date = error.message.match(/\d{4}-\d{2}-\d{2}/)?.[0]
    if (date) {
      return { headline: `Ya existe una posición diferente para el ${formatDay(date)}.`, detail: null }
    }
    return { headline: error.message, detail: null }
  }
  if (error instanceof ImportPeriodValidationError) {
    if (/no corresponde|no cierran/i.test(error.message)) {
      return {
        headline: 'Los documentos seleccionados no corresponden al mismo período.',
        detail: error.message,
      }
    }
    return { headline: error.message, detail: null }
  }
  console.error(error)
  return { headline: 'No se pudo importar el período.', detail: null }
}

function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  if (!year || !month || !day) return isoDate
  return `${day}/${month}/${year}`
}
