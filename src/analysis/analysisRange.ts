export type AnalysisRangeMode = 'SINGLE' | 'LAST_3' | 'LAST_6' | 'LAST_12' | 'YTD' | 'CUSTOM'
export interface AnalysisRange { startPeriodId: string; endPeriodId: string }
export interface AnalysisSelection { mode: AnalysisRangeMode; endPeriodId: string; customStartPeriodId?: string }
export interface RangePeriod { id: string; year: number; month: number }
export type RangeResolution =
  | { status: 'AVAILABLE'; range: AnalysisRange; periods: RangePeriod[] }
  | { status: 'INCOMPLETE_RANGE'; missingPeriods: string[]; startMonth: string; endMonth: string }
  | { status: 'UNAVAILABLE'; reason: 'END_NOT_IMPORTED' | 'START_NOT_IMPORTED' | 'START_AFTER_END' }

export function monthIndex(period: Pick<RangePeriod, 'year' | 'month'>) { return period.year * 12 + period.month - 1 }
export function monthKey(index: number) { return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}` }
export function rangePeriodLabel(period: Pick<RangePeriod, 'year' | 'month'>) {
  const names = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  return `${names[period.month - 1]} ${period.year}`
}

/** Input contains only imported COMPLETE periods; presets never truncate missing months. */
export function resolveAnalysisRange(periods: readonly RangePeriod[], selection: AnalysisSelection): RangeResolution {
  const end = periods.find(period => period.id === selection.endPeriodId)
  if (!end) return { status: 'UNAVAILABLE', reason: 'END_NOT_IMPORTED' }
  const endIndex = monthIndex(end)
  let startIndex = endIndex
  if (selection.mode === 'CUSTOM') {
    const start = periods.find(period => period.id === selection.customStartPeriodId)
    if (!start) return { status: 'UNAVAILABLE', reason: 'START_NOT_IMPORTED' }
    startIndex = monthIndex(start)
  } else if (selection.mode === 'YTD') startIndex = end.year * 12
  else startIndex -= ({ SINGLE: 1, LAST_3: 3, LAST_6: 6, LAST_12: 12 }[selection.mode] ?? 1) - 1
  if (startIndex > endIndex) return { status: 'UNAVAILABLE', reason: 'START_AFTER_END' }
  const byMonth = new Map(periods.map(period => [monthIndex(period), period]))
  const missingPeriods: string[] = []
  const included: RangePeriod[] = []
  for (let index = startIndex; index <= endIndex; index++) {
    const period = byMonth.get(index)
    if (period) included.push(period)
    else missingPeriods.push(monthKey(index))
  }
  if (missingPeriods.length) return { status: 'INCOMPLETE_RANGE', missingPeriods, startMonth: monthKey(startIndex), endMonth: monthKey(endIndex) }
  return { status: 'AVAILABLE', range: { startPeriodId: included[0]!.id, endPeriodId: end.id }, periods: included }
}