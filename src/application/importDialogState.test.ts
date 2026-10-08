import { describe, expect, it } from 'vitest'
import { ImportConflictError, ImportPeriodParsingError, ImportPeriodValidationError } from '../import/importPeriodErrors'
import { describeImportFailure } from './importFailure'
import { importDialogReducer, importOutcomeCopy, initialImportDialogState } from './importDialogState'
import type { ImportPeriodResultView } from './importPeriodApplication'

const files = [
  { path: 'C:\\docs\\cierre.pdf', name: 'cierre.pdf' },
  { path: 'C:\\docs\\cuenta.pdf', name: 'cuenta.pdf' },
  { path: 'C:\\docs\\fondos.pdf', name: 'fondos.pdf' },
]

const warningResult = view('created', 'WARNING')

describe('import dialog', () => {
  it('pasa de archivos elegidos a importando y no acepta un segundo envío', () => {
    const selected = importDialogReducer(initialImportDialogState, { type: 'select', files })
    expect(selected.status).toBe('files_selected')
    if (selected.status !== 'files_selected') return
    expect(selected.files).toHaveLength(3)
    const importing = importDialogReducer(selected, { type: 'start' })
    expect(importing.status).toBe('importing')
    expect(importDialogReducer(importing, { type: 'start' }).status).toBe('importing')
  })

  it('colapsa el mismo archivo repetido en una sola fila', () => {
    const selected = importDialogReducer(initialImportDialogState, {
      type: 'select',
      files: [files[0]!, files[0]!],
    })
    expect(selected).toMatchObject({
      status: 'files_selected',
      notice: 'Se dejó una sola copia del archivo repetido.',
    })
    if (selected.status !== 'files_selected') return
    expect(selected.files).toHaveLength(1)
  })

  it('muestra éxito, existente, error de período y conflicto', () => {
    const selected = importDialogReducer(initialImportDialogState, { type: 'select', files })
    const importing = importDialogReducer(selected, { type: 'start' })
    expect(importDialogReducer(importing, { type: 'finish', result: warningResult }).status).toBe('success')
    expect(importDialogReducer(importing, { type: 'finish', result: view('existing', 'WARNING') }).status).toBe('existing')

    const validation = describeImportFailure(
      new ImportPeriodValidationError('El resumen de fondos no corresponde a la fecha de cierre.'),
    )
    expect(validation.headline).toBe('Los documentos seleccionados no corresponden al mismo período.')
    expect(importDialogReducer(importing, { type: 'fail', ...validation }).status).toBe('error')

    const conflict = describeImportFailure(new ImportConflictError('Ya hay otro documento para el snapshot 2026-08-31.'))
    expect(conflict.headline).toBe('Ya existe una posición diferente para el 31/08/2026.')

    const parsing = describeImportFailure(new ImportPeriodParsingError(21))
    expect(parsing).toEqual({
      headline: 'No pudimos interpretar algunos movimientos del resumen mensual.',
      detail: '21 movimientos no pudieron leerse correctamente.',
    })
  })

  it('trata WARNING como importación completada y un análisis ausente como pendiente', () => {
    expect(importOutcomeCopy(warningResult).lead).toBe(
      'Importación completada con una pequeña diferencia pendiente de reconciliación.',
    )
    expect(importOutcomeCopy(view('created', 'RECONCILED')).lead).toBe('Importación completada.')
    expect(importOutcomeCopy(view('created', 'FAILED')).lead).toBe(
      'Los datos quedaron importados. El análisis no se pudo reconciliar.',
    )
    expect(importOutcomeCopy({ ...view('created', 'FAILED'), unsupportedInternalMovements: true }).lead).toBe(
      'Los datos se importaron correctamente. Este período contiene operaciones que todavía no pueden reconciliarse automáticamente.',
    )
    expect(importOutcomeCopy({ ...view('created', 'FAILED'), cashLedgerReconciled: true }).lead).toBe(
      'Caja reconciliada. La atribución de operaciones del período todavía está pendiente.',
    )
    expect(importOutcomeCopy({ ...view('created', 'FAILED'), positionAttributionPartial: true }).lead).toBe(
      'Atribución parcial del resultado',
    )
    expect(importOutcomeCopy(view('existing', 'WARNING')).lead).toBe('Este período ya estaba importado.')
    expect(importOutcomeCopy({ ...view('created', 'WARNING'), analysis: null }).lead).toBe(
      'Datos importados. Análisis pendiente.',
    )
  })
})

function view(
  outcome: 'created' | 'existing',
  status: 'WARNING' | 'RECONCILED' | 'FAILED',
): ImportPeriodResultView {
  return {
    outcome,
    period: { id: '1', year: 2026, month: 8, status: 'COMPLETE' },
    documents: [],
    summary: { positionsCount: 25, transactionsCount: 10, corporateActionsCount: 1 },
    unsupportedInternalMovements: false,
    cashLedgerReconciled: false,
    positionAttributionPartial: false,
    periodReturnLabel: null,
    analysis: {
      expectedResult: '179959.00',
      explainedResult: '179958.136',
      unexplainedDifference: '0.864',
      reconciliationStatus: status,
      unsupportedInternalMovements: false,
    },
  }
}
