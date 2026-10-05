import type { EntityId } from '../domain/common'

/**
 * Identidad estable de un ticker entre documentos.
 * META de julio y META de agosto comparten este id.
 * No es una fila de InstrumentRepository ni un id de SQLite.
 */
export function instrumentIdFromTicker(ticker: string): EntityId {
  return `instrument:${ticker}`
}
