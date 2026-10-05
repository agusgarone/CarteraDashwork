/// <reference types="node" />

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from '../engine/version'
import { APP_IDENTIFIER, APP_VERSION } from './appVersion'

describe('versión 0.1.0', () => {
  it('usa el mismo número en package, Tauri y Cargo, distinto del motor', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
    const tauri = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')) as {
      version: string
      identifier: string
      productName: string
    }
    const cargo = readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8')
    expect(packageJson.version).toBe(APP_VERSION)
    expect(tauri.version).toBe(APP_VERSION)
    expect(tauri.identifier).toBe(APP_IDENTIFIER)
    expect(tauri.productName).toBe('analisiscartera')
    expect(cargo).toMatch(/version = "0\.1\.0"/)
    expect(APP_VERSION).not.toBe(ENGINE_VERSION)
    expect(ENGINE_VERSION).toBe('1')
  })
})
