import { cn } from 'cn'
import { formatSignedCurrency } from '@/utils/formatCurrency'
import { formatPercentage } from '@/utils/formatPercentage'
import { toneClass } from '@/utils/tone'

interface SignedAmountProps {
  value: number
  format?: 'currency' | 'percentage'
  className?: string
}

export function SignedAmount({ value, format = 'currency', className }: SignedAmountProps) {
  const text = format === 'percentage' ? formatPercentage(value) : formatSignedCurrency(value)
  return <span className={cn('tabular-nums', toneClass(value), className)}>{text}</span>
}
