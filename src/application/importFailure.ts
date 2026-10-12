import { ImportConflictError, ImportPeriodParsingError, ImportPeriodValidationError } from '../import/importPeriodErrors'

export interface ImportFailureView {
  headline: string
  detail: string | null
}

export function describeImportFailure(error: unknown): ImportFailureView {
  if (error instanceof ImportConflictError) {
    if (error.message.includes('snapshot')) {
      return { headline: 'Mismo período/fecha con información diferente', detail: null }
    }
    return { headline: error.message, detail: null }
  }
  if (error instanceof ImportPeriodParsingError) {
    return {
      headline: 'No pudimos interpretar algunos movimientos del resumen mensual.',
      detail: error.message,
    }
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
