import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, FileText, Loader2 } from 'lucide-react'
import { cn } from 'cn'
import { useImportDialog } from '@/components/import/ImportDialogProvider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getNextImportLabel } from '@/services/portfolioService'
import type { DocumentStatus, ImportDocument } from '@/types/import'
import { formatCurrency } from '@/utils/formatCurrency'

const templates: Pick<ImportDocument, 'id' | 'label' | 'description'>[] = [
  {
    id: 'posicion-consolidada',
    label: 'Posición consolidada',
    description: 'Tenencia al cierre del mes.',
  },
  {
    id: 'resultados-periodo',
    label: 'Resultados del período',
    description: 'Resultado realizado y no realizado.',
  },
  {
    id: 'resumen-comitente',
    label: 'Resumen mensual comitente',
    description: 'Movimientos de la cuenta comitente.',
  },
  {
    id: 'resumen-cuotapartista',
    label: 'Resumen mensual cuotapartista',
    description: 'Movimientos de fondos comunes.',
  },
]

const statusLabel: Record<DocumentStatus, string> = {
  pending: 'Pendiente',
  uploaded: 'Archivo cargado',
  processing: 'Procesando',
  processed: 'Procesado',
  error: 'Error',
}

const acceptedExtensions = ['pdf', 'xls', 'xlsx']

function createDocuments(): ImportDocument[] {
  return templates.map((template) => ({
    ...template,
    status: 'pending',
    fileName: null,
    errorMessage: null,
  }))
}

function extensionOf(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function ImportMonthDialog() {
  const { open, setOpen } = useImportDialog()
  const wasOpen = useRef(false)
  const [documents, setDocuments] = useState<ImportDocument[]>(createDocuments)
  const [phase, setPhase] = useState<'edit' | 'done'>('edit')
  const [showDifference, setShowDifference] = useState(false)
  const runId = useRef(0)

  useEffect(() => {
    if (open && !wasOpen.current) {
      runId.current += 1
      setDocuments(createDocuments())
      setPhase('edit')
      setShowDifference(false)
    }
    wasOpen.current = open
  }, [open])

  const ready = documents.every((document) => document.status === 'uploaded' || document.status === 'processed')
  const busy = documents.some((document) => document.status === 'processing')

  function onFile(id: string, file: File | undefined) {
    if (!file) return
    const extension = extensionOf(file.name)
    setDocuments((current) =>
      current.map((document) => {
        if (document.id !== id) return document
        if (!acceptedExtensions.includes(extension)) {
          return {
            ...document,
            status: 'error',
            fileName: file.name,
            errorMessage: 'Formato no reconocido. Usá PDF o Excel.',
          }
        }
        return {
          ...document,
          status: 'uploaded',
          fileName: file.name,
          errorMessage: null,
        }
      }),
    )
    setPhase('edit')
  }

  function processPeriod() {
    const id = runId.current + 1
    runId.current = id
    setShowDifference(false)
    setDocuments((current) =>
      current.map((document) => ({ ...document, status: 'processing', errorMessage: null })),
    )
    window.setTimeout(() => {
      if (runId.current !== id) return
      setDocuments((current) =>
        current.map((document) => ({ ...document, status: 'processed', errorMessage: null })),
      )
      setPhase('done')
    }, 900)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100svh-3rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Actualizar cartera</DialogTitle>
          <DialogDescription>
            Importá los documentos de tu broker para incorporar un nuevo período al historial.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <label className="flex max-w-xs flex-col gap-1.5 text-xs text-muted-foreground">
            Seleccionar período
            <select
              defaultValue="2026-09"
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground"
            >
              <option value="2026-09">{getNextImportLabel()}</option>
            </select>
          </label>

          <div>
            <p className="text-sm font-medium">Documentos esperados para Balanz</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {documents.map((document) => (
                <UploadZone key={document.id} document={document} disabled={busy} onFile={onFile} />
              ))}
            </div>
          </div>

          {phase === 'edit' ? (
            <div className="flex justify-end">
              <Button type="button" disabled={!ready || busy} onClick={processPeriod}>
                {busy && <Loader2 className="animate-spin" />}
                Procesar período
              </Button>
            </div>
          ) : (
            <ProcessResult
              showDifference={showDifference}
              onToggleDifference={() => setShowDifference((current) => !current)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function UploadZone({
  document,
  disabled,
  onFile,
}: {
  document: ImportDocument
  disabled: boolean
  onFile: (id: string, file: File | undefined) => void
}) {
  const inputId = `import-${document.id}`
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-3 transition-colors hover:bg-muted/40',
        document.status === 'error' && 'border-negative/40 bg-negative/5',
        document.status === 'processed' && 'border-positive/30 bg-positive/5',
        disabled && 'pointer-events-none opacity-70',
      )}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (disabled) return
        onFile(document.id, event.dataTransfer.files?.[0])
      }}
    >
      <span className="flex items-start justify-between gap-3">
        <span>
          <span className="block text-sm font-medium">{document.label}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{document.description}</span>
        </span>
        <StatusIcon status={document.status} />
      </span>
      <span className="text-xs text-muted-foreground">
        {document.fileName ?? 'Arrastrá o seleccioná un archivo'}
      </span>
      <span
        className={cn(
          'text-xs font-medium',
          document.status === 'error' && 'text-negative',
          document.status === 'processed' && 'text-positive',
          document.status === 'uploaded' && 'text-foreground',
        )}
      >
        {document.errorMessage ?? statusLabel[document.status]}
      </span>
      <input
        id={inputId}
        type="file"
        accept=".pdf,.xls,.xlsx"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => onFile(document.id, event.target.files?.[0])}
      />
    </label>
  )
}

function StatusIcon({ status }: { status: DocumentStatus }) {
  if (status === 'processing') return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  if (status === 'processed' || status === 'uploaded') return <Check className="size-4 text-positive" />
  if (status === 'error') return <AlertCircle className="size-4 text-negative" />
  return <FileText className="size-4 text-muted-foreground" />
}

function ProcessResult({
  showDifference,
  onToggleDifference,
}: {
  showDifference: boolean
  onToggleDifference: () => void
}) {
  return (
    <div className="rounded-xl bg-muted/50 p-4">
      <p className="text-sm font-medium">{getNextImportLabel()} procesado correctamente</p>
      <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
        <li>4 documentos procesados</li>
        <li>23 instrumentos encontrados</li>
        <li>14 operaciones encontradas</li>
        <li>3 dividendos encontrados</li>
        <li>Aportes y retiros identificados</li>
      </ul>
      {showDifference ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Diferencia sin reconciliar: {formatCurrency(32_410)}
        </p>
      ) : (
        <p className="mt-4 text-sm font-medium text-positive">Reconciliación: Correcta</p>
      )}
      <button
        type="button"
        className="mt-3 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        onClick={onToggleDifference}
      >
        {showDifference ? 'Volver a reconciliación correcta' : 'Ver diferencia sin reconciliar'}
      </button>
    </div>
  )
}
