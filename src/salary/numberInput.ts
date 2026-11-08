import { decimalInput } from './model'

/** Form fields use the same decimal comma as the rest of the Spanish UI. */
export function parseBudgetNumber(value: string): string {
  if (value.includes('.'))
    throw new Error(
      'Ingresá números sin separadores de miles y usá coma para los decimales.',
    )
  return decimalInput(value)
}
export function formatBudgetNumber(value: string): string {
  return value.replace('.', ',')
}
