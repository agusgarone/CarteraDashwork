import { fileNameOf } from '../import/documentStore'

export type PickedDocuments =
  | { status: 'selected'; files: { path: string; name: string }[] }
  | { status: 'cancelled' }
  | { status: 'unavailable' }

/**
 * El selector acepta los PDF del período y el Excel opcional de resultados.
 * El tipo se decide por el contenido, no por el nombre.
 */
export async function pickImportDocuments(): Promise<PickedDocuments> {
  const { isTauri } = await import('@tauri-apps/api/core')
  if (!isTauri()) return { status: 'unavailable' }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    multiple: true,
    title: 'Documentos del período',
    filters: [{ name: 'Documentos', extensions: ['pdf', 'xlsx'] }],
  })
  if (selected === null) return { status: 'cancelled' }
  const paths = Array.isArray(selected) ? selected : [selected]
  return {
    status: 'selected',
    files: paths.map((filePath) => ({ path: filePath, name: fileNameOf(filePath) })),
  }
}
