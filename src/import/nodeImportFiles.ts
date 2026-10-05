/// <reference types="node" />

import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  absoluteDataPath,
  sha256Hex,
  type ImportFileSystem,
  type StagedFile,
} from './documentStore'

export function createNodeImportFiles(): ImportFileSystem {
  return {
    async stage(originalPath, stagingDir) {
      const bytes = new Uint8Array(await readFile(originalPath))
      const sha256 = await sha256Hex(bytes)
      await mkdir(stagingDir, { recursive: true })
      const stagedPath = path.join(stagingDir, sha256)
      await copyFile(originalPath, stagedPath)
      const staged: StagedFile = { originalPath, stagedPath, bytes, sha256 }
      return staged
    },
    async publish(appDataDir, relativePath, stagedPath) {
      const absolute = absoluteDataPath(appDataDir, relativePath, (...parts) => path.join(...parts))
      await mkdir(path.dirname(absolute), { recursive: true })
      try {
        await copyFile(stagedPath, absolute, constants.COPYFILE_EXCL)
        return { created: true }
      } catch (error) {
        if (isAlreadyExists(error)) return { created: false }
        throw error
      }
    },
    async removePublished(appDataDir, relativePath) {
      await rm(absoluteDataPath(appDataDir, relativePath, (...parts) => path.join(...parts)), { force: true })
    },
    async removeDir(absolutePath) {
      await rm(absolutePath, { recursive: true, force: true })
    },
    join(...parts) {
      return path.join(...parts)
    },
    basename(filePath) {
      return path.basename(filePath)
    },
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}
