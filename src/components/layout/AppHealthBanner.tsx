import { useEffect, useState } from 'react'
import { loadAppHealth, type AppHealth } from '@/application/appHealth'

export function AppHealthBanner() {
  const [health, setHealth] = useState<AppHealth | null>(null)
  const [showMissing, setShowMissing] = useState(false)

  useEffect(() => {
    let active = true
    void loadAppHealth().then((report) => {
      if (active) setHealth(report)
    })
    return () => {
      active = false
    }
  }, [])

  if (!health || health.status === 'desktop-only') return null

  if (health.status === 'error') {
    return (
      <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
        <p className="font-medium">La base de datos no está disponible</p>
        <p className="mt-1">{health.message}</p>
      </div>
    )
  }

  if (health.missingDocuments.length === 0) return null

  return (
    <div className="mb-6 rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm">
      <p>
        {health.missingDocuments.length === 1
          ? 'Hay 1 documento importado que no se encuentra en el disco.'
          : `Hay ${health.missingDocuments.length} documentos importados que no se encuentran en el disco.`}{' '}
        La aplicación sigue disponible.
      </p>
      <button type="button" className="mt-2 text-xs underline" onClick={() => setShowMissing((current) => !current)}>
        {showMissing ? 'Ocultar documentos' : 'Ver documentos'}
      </button>
      {showMissing ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {health.missingDocuments.map((relative) => (
            <li key={relative}>{relative}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
