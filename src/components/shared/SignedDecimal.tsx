import { cn } from 'cn'
import { formatSignedCurrencyARS } from '@/utils/formatCurrency'
import { toneClassFromDecimal } from '@/utils/tone'

export function SignedDecimal({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('tabular-nums', toneClassFromDecimal(value), className)}>
      {formatSignedCurrencyARS(value)}
    </span>
  )
}
