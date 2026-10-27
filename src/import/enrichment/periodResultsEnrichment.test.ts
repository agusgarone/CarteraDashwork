import { describe, expect, it } from 'vitest'
import type { ParsedPeriodResults } from '../../parsers/models/parsedPeriodResults'
import { assertPeriodResultsMatch } from './periodResultsEnrichment'

const january: ParsedPeriodResults = {
  documentType: 'PERIOD_RESULTS', openingDate: '2025-12-31', closingDate: '2026-01-31',
  initialLotCount: 0, realizedCount: 0, finalLotCount: 0, initialLots: [], finalLots: [], selections: [],
}
const bounds = {
  openingDate: '2025-12-30', closingDate: '2026-01-30',
  calendarPeriod: { startDate: '2026-01-01', endDate: '2026-01-31' },
}

describe('período calendario del Excel frente a fechas de valuación', () => {
  it('admite fechas calendario sin cambiar las fechas de los snapshots', () => {
    expect(() => assertPeriodResultsMatch(january, bounds)).not.toThrow()
    expect(bounds.openingDate).toBe('2025-12-30')
    expect(bounds.closingDate).toBe('2026-01-30')
  })
  it('rechaza un Excel de otro mes o con apertura equivocada', () => {
    expect(() => assertPeriodResultsMatch({ ...january, closingDate: '2026-02-28' }, bounds)).toThrow(/no corresponde/)
    expect(() => assertPeriodResultsMatch({ ...january, openingDate: '2025-11-30' }, bounds)).toThrow(/no corresponde/)
  })
  it('rechaza un snapshot de apertura de un mes anterior', () => {
    expect(() => assertPeriodResultsMatch(january, { ...bounds, openingDate: '2025-11-28' })).toThrow(/snapshot de apertura/)
  })
})