import type { PortfolioPeriod } from '../domain/period'

/** El resumen solo toma períodos COMPLETE. PENDING queda como apertura u otro mes incompleto. */
export function resolveOverviewPeriod(
  periods: readonly PortfolioPeriod[],
  selectedPeriodId: string | null,
): PortfolioPeriod | null {
  const complete = periods
    .filter((period) => period.status === 'COMPLETE')
    .sort((left, right) => left.year - right.year || left.month - right.month || left.id.localeCompare(right.id))

  if (selectedPeriodId) {
    const selected = complete.find((period) => period.id === selectedPeriodId)
    if (selected) return selected
  }

  return complete[complete.length - 1] ?? null
}
