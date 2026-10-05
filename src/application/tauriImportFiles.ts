import { exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import {
  absoluteDataPath,
  fileNameOf,
  sha256Hex,
  type ImportFileSystem,
} from '../import/documentStore'

/** Copia bytes. No escribe el texto extraído del PDF. */
export function createTauriImportFiles(): ImportFileSystem {
  return {
    async stage(originalPath, stagingDir) {
      const bytes = new Uint8Array(await readFile(originalPath))
      const sha256 = await sha256Hex(bytes)
      await mkdir(stagingDir, { recursive: true })
      const stagedPath = joinPath(stagingDir, sha256)
      await writeFile(stagedPath, bytes)
      return { originalPath, stagedPath, bytes, sha256 }
    },
    async publish(appDataDir, relativePath, stagedPath) {
      const absolute = absoluteDataPath(appDataDir, relativePath, joinPath)
      await mkdir(parentPath(absolute), { recursive: true })
      if (await exists(absolute)) return { created: false }
      const bytes = new Uint8Array(await readFile(stagedPath))
      await writeFile(absolute, bytes, { createNew: true })
      return { created: true }
    },
    async removePublished(appDataDir, relativePath) {
      await removeIfPresent(absoluteDataPath(appDataDir, relativePath, joinPath))
    },
    async removeDir(absolutePath) {
      await removeIfPresent(absolutePath)
    },
    join: joinPath,
    basename: fileNameOf,
  }
}

async function removeIfPresent(absolutePath: string): Promise<void> {
  if (!(await exists(absolutePath))) return
  await remove(absolutePath, { recursive: true })
}

function joinPath(...parts: string[]): string {
  const windows = parts.some((part) => part.includes('\\') || /^[a-zA-Z]:/.test(part))
  const separator = windows ? '\\' : '/'
  const first = parts[0] ?? ''
  const prefix = first.startsWith('/') && !windows ? '/' : ''
  const body = parts
    .flatMap((part) => part.split(/[\\/]/))
    .filter((part) => part.length > 0)
    .join(separator)
  return `${prefix}${body}`
}

function parentPath(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index <= 0 ? filePath : filePath.slice(0, index)
}
