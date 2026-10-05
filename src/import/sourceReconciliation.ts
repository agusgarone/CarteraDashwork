import { formatExact, parseDecimal } from '../engine/money'

/**
 * openingDocumentDifference − closingDocumentDifference.
 *
 * Explica el desfase entre el total impreso y el detalle de cada PDF.
 * No es rendimiento y no se suma a explainedResult.
 */
export function sourceReconciliationDifference(
  openingDocumentDifference: string,
  closingDocumentDifference: string,
): string {
  return formatExact(parseDecimal(openingDocumentDifference).minus(closingDocumentDifference))
}
