export function toneClass(value: number) {
  if (value > 0) return 'text-positive'
  if (value < 0) return 'text-negative'
  return 'text-muted-foreground'
}

export function toneClassFromDecimal(value: string) {
  if (!/[1-9]/.test(value)) return 'text-muted-foreground'
  if (value.trim().startsWith('-')) return 'text-negative'
  return 'text-positive'
}
