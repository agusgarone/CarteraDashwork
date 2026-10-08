/// <reference types="node" />

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { PortfolioPeriod } from '../domain/period'
import { resolveOverviewPeriod } from './overviewPeriod'
import { reconciliationNote } from './overviewCopy'
import { initialOverviewScreen, overviewScreenReducer } from './overviewScreen'

function period(id: string, month: number, status: PortfolioPeriod['status']): PortfolioPeriod {
  return {
    id,
    portfolioId: 'portfolio',
    year: 2026,
    month,
    status,
    createdAt: '2026-10-05T00:00:00.000Z',
    completedAt: status === 'COMPLETE' ? '2026-10-05T00:00:00.000Z' : null,
  }
}

describe('resolveOverviewPeriod', () => {
  const july = period('july', 7, 'PENDING')
  const august = period('august', 8, 'COMPLETE')
  const september = period('september', 9, 'COMPLETE')

  it('sin selección usa el último COMPLETE', () => {
    expect(resolveOverviewPeriod([september, july, august], null)?.id).toBe('september')
  })

  it('respeta el período COMPLETE seleccionado', () => {
    expect(resolveOverviewPeriod([july, august, september], 'august')?.id).toBe('august')
  })

  it('ignora un PENDING aunque esté seleccionado', () => {
    expect(resolveOverviewPeriod([july, august], 'july')?.id).toBe('august')
  })

  it('no elige un mes si solo hay PENDING', () => {
    expect(resolveOverviewPeriod([july], null)).toBeNull()
    expect(resolveOverviewPeriod([july], 'july')).toBeNull()
  })
})

describe('overviewScreenReducer', () => {
  it('empieza en loading y un error no conserva una vista', () => {
    expect(initialOverviewScreen).toEqual({ status: 'loading' })
    const failed = overviewScreenReducer(initialOverviewScreen, {
      type: 'error',
      message: 'No se pudo leer el resumen.',
    })
    expect(failed).toEqual({ status: 'error', message: 'No se pudo leer el resumen.' })
    expect(failed).not.toHaveProperty('view')
  })

  it('una base vacía no cae en números de ejemplo', () => {
    expect(overviewScreenReducer(initialOverviewScreen, { type: 'empty' })).toEqual({ status: 'empty' })
  })

  it('volver a cargar reemplaza un resultado anterior', () => {
    const ready = overviewScreenReducer(initialOverviewScreen, {
      type: 'ready',
      view: { period: { id: '1' } } as never,
    })
    expect(overviewScreenReducer(ready, { type: 'load' })).toEqual({ status: 'loading' })
  })
})

describe('separación de mocks', () => {
  it('resumen y detalle no usan el servicio mock', () => {
    const root = path.dirname(fileURLToPath(import.meta.url))
    const dashboard = readFileSync(path.join(root, '../pages/DashboardPage.tsx'), 'utf8')
    const detail = readFileSync(path.join(root, '../pages/DetailPage.tsx'), 'utf8')
    const cards = readFileSync(path.join(root, '../components/dashboard/MetricCards.tsx'), 'utf8')
    const shell = readFileSync(path.join(root, '../components/layout/AppShell.tsx'), 'utf8')
    expect(dashboard).not.toContain('portfolioService')
    expect(dashboard).not.toContain('@/mocks')
    expect(detail).not.toContain('portfolioService')
    expect(detail).not.toContain('@/mocks')
    expect(detail).not.toContain('formatPercentage')
    expect(detail).not.toContain('formatReturnPercent')
    expect(detail).not.toContain('MODIFIED_DIETZ')
    expect(detail).not.toContain('investedCapital')
    expect(cards).toContain('Rendimiento del período')
    expect(cards).toContain('formatReturnPercent')
    expect(cards).not.toContain('+7,12%')
    expect(cards).not.toContain('investmentResult /')
    expect(shell).not.toContain("from '@/components/period/PeriodSelector'")
  })
})

describe('reconciliationNote', () => {
  it('trata WARNING como diferencia pendiente', () => {
    expect(reconciliationNote('WARNING', '0.864')).toBe('Diferencia pendiente: $0,86')
    expect(reconciliationNote('WARNING', '0.864')).not.toMatch(/fall/i)
  })

  it('no muestra diferencia cuando está reconciliado', () => {
    expect(reconciliationNote('RECONCILED', '0.00')).toBeNull()
  })

  it('separa un análisis no reconciliable de una importación vacía', () => {
    expect(reconciliationNote('FAILED', '10.00')).toBe(
      'Los datos se importaron correctamente. Este período contiene operaciones que todavía no pueden reconciliarse automáticamente.',
    )
  })

  it('no inventa ceros si falta el análisis', () => {
    expect(reconciliationNote(null, null)).toBe('Datos importados. Análisis pendiente.')
  })
})
