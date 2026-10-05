import { AnalysisError } from './errors/analysisErrors'

const DAY_MS = 86_400_000

/**
 * Día civil YYYY-MM-DD.
 * La resta se hace en UTC a partir de la fecha, no de la hora local.
 * 2026-07-31 y 2026-08-31 quedan a 31 días en cualquier zona.
 */
export function daysBetween(start: string, end: string): number {
  return (calendarUtc(end) - calendarUtc(start)) / DAY_MS
}

function calendarUtc(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new AnalysisError(`Fecha no válida: ${value}. Se espera YYYY-MM-DD.`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = Date.UTC(year, month - 1, day)
  const check = new Date(utc)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new AnalysisError(`Fecha no válida: ${value}.`)
  }
  return utc
}
