/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('superficie v0.1', () => {
  it('el webview solo manda SQL desde el cliente de base', () => {
    const hits = sourceFiles(SRC)
      .filter((file) => !file.endsWith('.test.ts'))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8')
        return ['db_select', 'db_execute', 'db_transaction'].flatMap((command) =>
          text.includes(command) ? [`${path.relative(SRC, file)}:${command}`] : [],
        )
      })
    expect(hits.map((hit) => hit.replaceAll('\\', '/'))).toEqual(['database/database.ts:db_select', 'database/database.ts:db_execute', 'database/database.ts:db_transaction'])
  })

  it('Datos muestra la advertencia y no calcula rendimientos', () => {
    const page = readFileSync(path.join(SRC, 'pages/DataPage.tsx'), 'utf8')
    expect(page).toContain(
      'El backup contiene tus datos financieros y documentos importados. Guardalo en un lugar seguro.',
    )
    expect(page).not.toContain('formatReturnPercent')
    expect(page).not.toContain('modifiedDietz')
    expect(page).not.toContain('PortfolioEngine')
  })
})

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : []
  })
}
