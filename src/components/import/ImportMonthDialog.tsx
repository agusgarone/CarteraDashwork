import { useEffect, useReducer, useRef } from 'react'
import { AlertCircle, Check, FileText, Loader2 } from 'lucide-react'
import { useImportDialog } from '@/components/import/ImportDialogProvider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { describeImportFailure } from '@/application/importFailure'
import type { ImportPeriodResultView } from '@/application/importPeriodApplication'
import {
  importDialogReducer,
  importOutcomeCopy,
  initialImportDialogState,
} from '@/application/importDialogState'
import { importFromDesktop } from '@/application/importFromDesktop'
import { useImportedPeriod } from '@/application/ImportedPeriodProvider'
import { pickImportDocuments } from '@/application/pickImportDocuments'
import type { DocumentType } from '@/domain/document'
import { formatCurrencyARS } from '@/utils/formatCurrency'

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

const documentLabel: Record<DocumentType, string> = {
  CONSOLIDATED_POSITION: 'Posición consolidada',
  MONTHLY_ACCOUNT: 'Resumen mensual',
  MONTHLY_FUND_STATEMENT: 'Resumen de fondos',
  PERIOD_RESULTS: 'Resultados del período',
  OTHER: 'Documento',
}

export function ImportMonthDialog() {
  const { open, setOpen } = useImportDialog()
  const { selectImportedPeriod } = useImportedPeriod()
  const wasOpen = useRef(false)
  const remembered = useRef(false)
  const [state, dispatch] = useReducer(importDialogReducer, initialImportDialogState)
  const importing = state.status === 'importing'

  useEffect(() => {
    if (open && !wasOpen.current) {
      remembered.current = false
      dispatch({ type: 'reset' })
    }
    wasOpen.current = open
  }, [open])

  function closeDialog() {
    if (importing) return
    if (!remembered.current && (state.status === 'success' || state.status === 'existing')) {
      remembered.current = true
      selectImportedPeriod({
        id: state.result.period.id,
        year: state.result.period.year,
        month: state.result.period.month,
      })
    }
    setOpen(false)
  }

  async function chooseFiles() {
    const picked = await pickImportDocuments()
    if (picked.status === 'unavailable') {
      dispatch({ type: 'unavailable' })
      return
    }
    if (picked.status === 'selected') dispatch({ type: 'select', files: picked.files })
  }

  async function runImport() {
    if (state.status !== 'files_selected') return
    const files = state.files
    dispatch({ type: 'start' })
    try {
      const result = await importFromDesktop(files.map((file) => file.path))
      dispatch({ type: 'finish', result })
    } catch (error) {
      const failure = describeImportFailure(error)
      dispatch({ type: 'fail', headline: failure.headline, detail: failure.detail })
    }
  }

  const files = 'files' in state ? state.files : []

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog()
        else setOpen(true)
      }}
    >
      <DialogContent
        className="max-h-[calc(100svh-3rem)] overflow-y-auto sm:max-w-3xl"
        showCloseButton={!importing}
        onEscapeKeyDown={(event) => {
          if (importing) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (importing) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">Actualizar cartera</DialogTitle>
          <DialogDescription>
            Elegí los PDF del período. El tipo de cada documento se reconoce por el contenido.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Posición consolidada de cierre, resumen mensual comitente y resumen de fondos. La posición de apertura es opcional si ese snapshot ya está importado.
          </p>

          {state.status === 'unavailable' ? (
            <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
              La selección de archivos reales está disponible en la aplicación de escritorio.
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="outline" disabled={importing} onClick={() => void chooseFiles()}>
              Seleccionar documentos
            </Button>
            {files.length > 0 ? (
              <span className="text-sm text-muted-foreground">{files.length} archivos seleccionados</span>
            ) : null}
          </div>

          {files.length > 0 ? (
            <ul className="space-y-2">
              {files.map((file) => (
                <li key={file.path} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {state.status === 'files_selected' && state.notice ? (
            <p className="text-sm text-muted-foreground">{state.notice}</p>
          ) : null}

          {state.status === 'error' ? (
            <div className="rounded-xl border border-negative/30 bg-negative/5 px-4 py-3 text-sm">
              <p className="flex items-start gap-2 font-medium">
                <AlertCircle className="mt-0.5 size-4 text-negative" />
                {state.headline}
              </p>
              {state.detail ? <p className="mt-2 text-muted-foreground">{state.detail}</p> : null}
            </div>
          ) : null}

          {state.status === 'success' || state.status === 'existing' ? (
            <ImportResult result={state.result} />
          ) : null}

          {state.status === 'success' || state.status === 'existing' ? (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cerrar
              </Button>
              <Button type="button" onClick={closeDialog}>
                Ver resumen
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button type="button" disabled={state.status !== 'files_selected'} onClick={() => void runImport()}>
                {importing && <Loader2 className="animate-spin" />}
                Importar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ImportResult({ result }: { result: ImportPeriodResultView }) {
  const copy = importOutcomeCopy(result)
  const month = MONTHS[result.period.month - 1] ?? String(result.period.month)
  return (
    <div className="rounded-xl bg-muted/50 p-4">
      <p className="flex items-start gap-2 text-sm font-medium">
        <Check className="mt-0.5 size-4 text-positive" />
        {copy.lead}
      </p>
      {copy.note ? <p className="mt-2 text-sm text-muted-foreground">{copy.note}</p> : null}
      <p className="mt-4 text-sm font-medium">{month} {result.period.year}</p>
      <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
        {result.documents.map((document) => (
          <li key={`${document.type}-${document.date}-${document.fileName}`}>
            {documentLabel[document.type]} — {formatDay(document.date)}
          </li>
        ))}
        <li>{result.summary.positionsCount} posiciones</li>
        <li>{result.summary.transactionsCount} movimientos</li>
        <li>
          {result.summary.corporateActionsCount}{' '}
          {result.summary.corporateActionsCount === 1 ? 'acción corporativa' : 'acciones corporativas'}
        </li>
      </ul>
      {result.analysis ? (
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Resultado de inversiones</dt>
            <dd>{formatCurrencyARS(result.analysis.expectedResult)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Explicado</dt>
            <dd>{formatCurrencyARS(result.analysis.explainedResult)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Diferencia</dt>
            <dd>{formatCurrencyARS(result.analysis.unexplainedDifference)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Estado</dt>
            <dd>{result.analysis.reconciliationStatus}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  )
}

function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  if (!year || !month || !day) return isoDate
  return `${day}/${month}/${year}`
}
