/// <reference types="node" />

import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export interface StagedFile {
  originalPath: string
  stagedPath: string
  bytes: Uint8Array
  sha256: string
}

/**
 * Copia el archivo del usuario a un staging. No lo mueve ni lo borra.
 * El hash se calcula sobre esa copia.
 */
export async function stageUserFile(originalPath: string, stagingDir: string): Promise<StagedFile> {
  const bytes = new Uint8Array(await readFile(originalPath))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await mkdir(stagingDir, { recursive: true })
  const stagedPath = path.join(stagingDir, sha256)
  await copyFile(originalPath, stagedPath)
  return { originalPath, stagedPath, bytes, sha256 }
}

/**
 * Publica en documents/YYYY/MM/<hash>-<slug>.ext, siempre con barras normales.
 * Si el destino ya existe, no se pisa: el hash es el nombre.
 * Devuelve si este intento creó el archivo, para poder borrarlo si la base falla.
 */
export async function publishDocument(
  appDataDir: string,
  relativePath: string,
  stagedPath: string,
): Promise<{ created: boolean }> {
  const absolute = absoluteDataPath(appDataDir, relativePath)
  await mkdir(path.dirname(absolute), { recursive: true })
  try {
    await copyFile(stagedPath, absolute, constants.COPYFILE_EXCL)
    return { created: true }
  } catch (error) {
    if (isAlreadyExists(error)) return { created: false }
    throw error
  }
}

export async function removePublished(appDataDir: string, relativePath: string): Promise<void> {
  await rm(absoluteDataPath(appDataDir, relativePath), { force: true })
}

export function documentRelativePath(
  isoDate: string,
  sha256: string,
  slug: string,
  extension: string,
): string {
  const [year, month] = isoDate.split('-')
  return `documents/${year}/${month}/${sha256}-${slug}${extension}`
}

function absoluteDataPath(appDataDir: string, relativePath: string): string {
  return path.join(appDataDir, ...relativePath.split('/'))
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
