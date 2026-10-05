export interface StagedFile {
  originalPath: string
  stagedPath: string
  bytes: Uint8Array
  sha256: string
}

/**
 * Lectura y copia de los archivos del usuario.
 * Los tests usan el disco de Node. La app usa el plugin de archivos de Tauri.
 * En ambos casos se copian los bytes originales: el texto extraído no se guarda.
 */
export interface ImportFileSystem {
  stage(originalPath: string, stagingDir: string): Promise<StagedFile>
  publish(appDataDir: string, relativePath: string, stagedPath: string): Promise<{ created: boolean }>
  removePublished(appDataDir: string, relativePath: string): Promise<void>
  removeDir(absolutePath: string): Promise<void>
  join(...parts: string[]): string
  basename(filePath: string): string
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function fileNameOf(filePath: string): string {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

/**
 * Conserva la extensión del archivo elegido.
 * .xlsx queda reservada para cuando exista ese parser: hoy el selector solo ofrece PDF.
 */
export function originalExtension(filename: string): string {
  const base = fileNameOf(filename)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return '.bin'
  const extension = base.slice(dot).toLowerCase()
  if (extension === '.pdf' || extension === '.txt' || extension === '.xlsx' || extension === '.xls') return extension
  return '.bin'
}

export function documentRelativePath(isoDate: string, sha256: string, slug: string, extension: string): string {
  const [year, month] = isoDate.split('-')
  return `documents/${year}/${month}/${sha256}-${slug}${extension}`
}

export function absoluteDataPath(appDataDir: string, relativePath: string, join: (...parts: string[]) => string): string {
  return join(appDataDir, ...relativePath.split('/'))
}
