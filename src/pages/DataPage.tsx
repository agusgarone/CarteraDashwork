import { isTauri } from '@tauri-apps/api/core'
import { useState } from 'react'
import {
  createBackupFromDesktop,
  loadAppLocation,
  restoreBackupFromDesktop,
  type AppLocation,
} from '@/application/backupFromDesktop'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

const NOTICE_KEY = 'analisis-cartera-backup-notice'

type Notice =
  | { kind: 'created'; path: string }
  | { kind: 'restored'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

export function DataPage() {
  const [desktop] = useState(() => isTauri())
  const [notice, setNotice] = useState<Notice | null>(() => readStoredNotice())
  const [working, setWorking] = useState<'create' | 'restore' | null>(null)
  const [locations, setLocations] = useState<AppLocation | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)

  async function createBackup() {
    setWorking('create')
    setNotice(null)
    try {
      const result = await createBackupFromDesktop()
      setNotice(result.status === 'cancelled' ? { kind: 'cancelled' } : { kind: 'created', path: result.path })
    } catch (error) {
      setNotice({ kind: 'error', message: messageOf(error) })
    } finally {
      setWorking(null)
    }
  }

  async function restoreBackup() {
    setWorking('restore')
    setNotice(null)
    try {
      const result = await restoreBackupFromDesktop()
      if (result.status === 'cancelled') {
        setNotice({ kind: 'cancelled' })
        return
      }
      sessionStorage.setItem(NOTICE_KEY, JSON.stringify({ kind: 'restored', path: result.path }))
      window.location.reload()
    } catch (error) {
      setNotice({ kind: 'error', message: messageOf(error) })
    } finally {
      setWorking(null)
    }
  }

  async function showLocations() {
    setLocationError(null)
    try {
      setLocations(await loadAppLocation())
    } catch (error) {
      setLocationError(messageOf(error))
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración / Datos</h1>
        <p className="mt-1 text-sm text-muted-foreground">Copia local de la base y de los documentos importados.</p>
      </header>

      <Card>
        <CardHeader>
          <p className="text-base font-medium">Backup</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed">
            El backup contiene tus datos financieros y documentos importados. Guardalo en un lugar seguro.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Esta copia se guarda sin cifrado. El cifrado queda para una versión siguiente.
          </p>
          {desktop ? null : (
            <p className="text-sm">La copia de seguridad está disponible en la aplicación de escritorio.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!desktop || working !== null} onClick={() => void createBackup()}>
              {working === 'create' ? 'Creando backup…' : 'Crear backup'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!desktop || working !== null}
              onClick={() => void restoreBackup()}
            >
              {working === 'restore' ? 'Restaurando…' : 'Restaurar backup'}
            </Button>
          </div>
          <BackupNotice notice={notice} />
          <div>
            <Button type="button" variant="ghost" disabled={!desktop} onClick={() => void showLocations()}>
              Ver ubicación
            </Button>
            {locations ? (
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <p>Base: {locations.databasePath}</p>
                <p>Documentos: {locations.documentsDir}</p>
              </div>
            ) : null}
            {locationError ? <p className="mt-2 text-sm text-destructive">{locationError}</p> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function BackupNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  if (notice.kind === 'created') {
    return (
      <div className="space-y-1 text-sm">
        <p>Backup creado.</p>
        <p className="break-all text-muted-foreground">{notice.path}</p>
      </div>
    )
  }
  if (notice.kind === 'restored') {
    return (
      <div className="space-y-1 text-sm">
        <p>Backup restaurado. Los datos en pantalla corresponden a esa copia.</p>
        <p className="break-all text-muted-foreground">{notice.path}</p>
      </div>
    )
  }
  if (notice.kind === 'cancelled') {
    return <p className="text-sm text-muted-foreground">No se eligió un archivo.</p>
  }
  return <p className="text-sm text-destructive">{notice.message}</p>
}

function readStoredNotice(): Notice | null {
  try {
    const stored = sessionStorage.getItem(NOTICE_KEY)
    if (!stored) return null
    sessionStorage.removeItem(NOTICE_KEY)
    return parseNotice(stored)
  } catch {
    return null
  }
}

function parseNotice(stored: string): Notice | null {
  try {
    const value = JSON.parse(stored) as Partial<Notice>
    if (value.kind === 'restored' && typeof value.path === 'string') return { kind: 'restored', path: value.path }
    if (value.kind === 'created' && typeof value.path === 'string') return { kind: 'created', path: value.path }
    return null
  } catch {
    return null
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'No se pudo completar la operación.'
}
