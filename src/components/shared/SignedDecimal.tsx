import { cn } from 'cn'
import { useDisplayCurrency } from '@/presentation/DisplayCurrencyProvider'
import { toneClassFromDecimal } from '@/utils/tone'

export function SignedDecimal({ value, className }: { value: string; className?: string }) {
  const display = useDisplayCurrency()
  return (
    <span className={cn('tabular-nums', toneClassFromDecimal(value), className)} title={display.precise(value)}>
      {display.signed(value)}
    </span>
  )
}