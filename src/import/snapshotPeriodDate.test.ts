import { describe, expect, it } from 'vitest'
import { matchesPeriodClose } from './snapshotPeriodDate'

describe('fechas de cierre mensual', () => {
  it('acepta cierres exactos y el viernes anterior a fin de mes en fin de semana', () => {
    expect(matchesPeriodClose('2026-01-30', '2026-01-31')).toBe(true)
    expect(matchesPeriodClose('2026-05-29', '2026-05-31')).toBe(true)
    expect(matchesPeriodClose('2026-07-31', '2026-07-31')).toBe(true)
  })
  it('rechaza otro mes, un cierre viejo y diferencias en días laborables', () => {
    expect(matchesPeriodClose('2025-12-31', '2026-01-31')).toBe(false)
    expect(matchesPeriodClose('2026-01-29', '2026-01-31')).toBe(false)
    expect(matchesPeriodClose('2026-07-30', '2026-07-31')).toBe(false)
    expect(matchesPeriodClose('2026-01-23', '2026-01-25')).toBe(false)
  })
})