/** Accept the calendar close or its preceding Friday when month-end is a weekend.
 * Snapshot dates remain the dates printed in the documents.
 */
export function matchesPeriodClose(snapshotDate: string, periodEnd: string): boolean {
  if (snapshotDate === periodEnd) return true
  const end = new Date(`${periodEnd}T00:00:00Z`)
  if (!Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== periodEnd) return false
  const next = new Date(end)
  next.setUTCDate(next.getUTCDate() + 1)
  if (next.getUTCDate() !== 1) return false
  while (end.getUTCDay() === 0 || end.getUTCDay() === 6) end.setUTCDate(end.getUTCDate() - 1)
  return snapshotDate === end.toISOString().slice(0, 10)
}