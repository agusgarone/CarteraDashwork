import type { DocumentType } from '../domain/document'

export type ImportableDocumentType = Extract<
  DocumentType,
  'CONSOLIDATED_POSITION' | 'MONTHLY_ACCOUNT' | 'MONTHLY_FUND_STATEMENT'
>

/**
 * El nombre del archivo no decide el tipo ni el período.
 * Cada parser exige su título. Si el texto coincide con más de uno, no se elige.
 */
export function detectBalanzDocument(text: string): ImportableDocumentType | null {
  const fund =
    /fondo com[uú]n de inversi[oó]n/i.test(text) && /informe del total de su inversi[oó]n/i.test(text)
  const consolidated = /posici[oó]n consolidada/i.test(text)
  const monthly = /resumen mensual comitente|cuenta corriente por concertaci[oó]n/i.test(text)
  const matches: ImportableDocumentType[] = []
  if (fund) matches.push('MONTHLY_FUND_STATEMENT')
  if (consolidated) matches.push('CONSOLIDATED_POSITION')
  if (monthly) matches.push('MONTHLY_ACCOUNT')
  if (matches.length !== 1) return null
  return matches[0] ?? null
}
