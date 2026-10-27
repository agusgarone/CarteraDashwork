import { ParserError } from '../errors/parserErrors'
import { readMovementTicker } from './statementTable'

/** A ticker is explicit only inside the structured Balanz boleto description. */
export function readExplicitOperationTicker(description: string): string | null {
  const match = description.match(/^boleto\s*\/\s*\d+\s*\/[^/]+\/\s*\d+\s*\/\s*([A-Z][A-Z0-9.]{0,14})\s*\/\s*(?:\$|u\$s|usd|mep|cable)(?:\s+(?:mep|cable))?\s*$/i)
  return match?.[1]?.toUpperCase() ?? null
}

/** Explicit operation identity wins over a row suffix and inherited section. */
export function resolveOperationTicker(input: { description: string; sectionTicker?: string | null; operationDescriptions?: readonly string[] }): string | null {
  if (/suscripci|rescate/i.test(input.description)) return null
  const explicit = [...new Set((input.operationDescriptions ?? [input.description])
    .map(readExplicitOperationTicker).filter((ticker): ticker is string => ticker !== null))]
  if (explicit.length > 1) throw new ParserError('El mismo boleto indica más de un ticker explícito.')
  return explicit[0] ?? readExplicitOperationTicker(input.description) ?? readMovementTicker(input.description) ?? input.sectionTicker ?? null
}