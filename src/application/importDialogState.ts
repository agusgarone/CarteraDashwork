import type { ImportPeriodResultView } from './importPeriodApplication'
import type { ReconciliationStatus } from '../domain/reconciliation'

export interface SelectedImportFile {
  path: string
  name: string
}

export type ImportDialogState =
  | { status: 'idle'; notice: string | null }
  | { status: 'files_selected'; files: SelectedImportFile[]; notice: string | null }
  | { status: 'importing'; files: SelectedImportFile[] }
  | { status: 'success'; files: SelectedImportFile[]; result: ImportPeriodResultView }
  | { status: 'existing'; files: SelectedImportFile[]; result: ImportPeriodResultView }
  | { status: 'error'; files: SelectedImportFile[]; headline: string; detail: string | null }
  | { status: 'unavailable' }

export type ImportDialogAction =
  | { type: 'select'; files: SelectedImportFile[] }
  | { type: 'start' }
  | { type: 'finish'; result: ImportPeriodResultView }
  | { type: 'fail'; headline: string; detail: string | null }
  | { type: 'unavailable' }
  | { type: 'reset' }

export const initialImportDialogState: ImportDialogState = { status: 'idle', notice: null }

export function importDialogReducer(state: ImportDialogState, action: ImportDialogAction): ImportDialogState {
  if (action.type === 'reset') {
    if (state.status === 'importing') return state
    return initialImportDialogState
  }
  if (action.type === 'unavailable') {
    if (state.status === 'importing') return state
    return { status: 'unavailable' }
  }
  if (action.type === 'select') {
    if (state.status === 'importing') return state
    const unique = uniqueFiles(action.files)
    if (unique.files.length === 0) return { status: 'idle', notice: null }
    return {
      status: 'files_selected',
      files: unique.files,
      notice: unique.droppedDuplicate ? 'Se dejó una sola copia del archivo repetido.' : null,
    }
  }
  if (action.type === 'start') {
    if (state.status !== 'files_selected') return state
    return { status: 'importing', files: state.files }
  }
  if (action.type === 'finish') {
    if (state.status !== 'importing') return state
    const status = action.result.outcome === 'existing' ? 'existing' : 'success'
    return { status, files: state.files, result: action.result }
  }
  if (state.status !== 'importing') return state
  return {
    status: 'error',
    files: state.files,
    headline: action.headline,
    detail: action.detail,
  }
}

export function importOutcomeCopy(result: ImportPeriodResultView): { lead: string; note: string | null } {
  if (!result.analysis) {
    return {
      lead: result.outcome === 'existing' ? 'Este período ya estaba importado.' : 'Datos importados. Análisis pendiente.',
      note: result.outcome === 'existing' ? 'Datos importados. Análisis pendiente.' : null,
    }
  }
  if (result.outcome === 'existing') {
    return { lead: 'Este período ya estaba importado.', note: statusNote(result.analysis.reconciliationStatus) }
  }
  return { lead: completedLead(result.analysis.reconciliationStatus), note: null }
}

function completedLead(status: ReconciliationStatus): string {
  if (status === 'WARNING') {
    return 'Importación completada con una pequeña diferencia pendiente de reconciliación.'
  }
  if (status === 'FAILED') return 'Los datos quedaron importados. El análisis no se pudo reconciliar.'
  return 'Importación completada.'
}

function statusNote(status: ReconciliationStatus): string | null {
  if (status === 'WARNING') return 'Queda una pequeña diferencia pendiente de reconciliación.'
  if (status === 'FAILED') return 'El análisis no se pudo reconciliar.'
  return null
}

function uniqueFiles(files: SelectedImportFile[]): { files: SelectedImportFile[]; droppedDuplicate: boolean } {
  const seen = new Set<string>()
  const unique: SelectedImportFile[] = []
  for (const file of files) {
    const key = file.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(file)
  }
  return { files: unique, droppedDuplicate: unique.length !== files.length }
}
