import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePeriod } from '@/components/period/PeriodProvider'
import { getAvailablePeriods } from '@/services/portfolioService'
import type { PeriodPreset } from '@/types/portfolio'

const presets: { id: PeriodPreset; label: string }[] = [
  { id: 'now', label: 'Ahora' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: 'ytd', label: 'YTD' },
  { id: '1y', label: '1A' },
]

export function PeriodSelector() {
  const { selection, applyCustomRange, setPreset } = usePeriod()
  const months = getAvailablePeriods()
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(selection.startMonthId)
  const [draftEnd, setDraftEnd] = useState(selection.endMonthId)

  function openCustom(nextOpen: boolean) {
    if (nextOpen) {
      setDraftStart(selection.startMonthId)
      setDraftEnd(selection.endMonthId)
    }
    setOpen(nextOpen)
  }

  function apply() {
    applyCustomRange(draftStart, draftEnd)
    setOpen(false)
  }

  return (
    <div className="inline-flex items-center rounded-lg bg-card p-0.5 ring-1 ring-foreground/10">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => setPreset(preset.id)}
          className={cn(
            'h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors',
            selection.preset === preset.id && 'bg-foreground text-background',
          )}
        >
          {preset.label}
        </button>
      ))}
      <Popover open={open} onOpenChange={openCustom}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors',
              selection.preset === 'custom' && 'bg-foreground text-background',
            )}
          >
            Personalizado
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 gap-3 p-4">
          <p className="text-sm font-medium">Período personalizado</p>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Desde
            <select
              value={draftStart}
              onChange={(event) => setDraftStart(event.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground"
            >
              {months.map((month) => (
                <option key={month.id} value={month.id}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Hasta
            <select
              value={draftEnd}
              onChange={(event) => setDraftEnd(event.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground"
            >
              {months.map((month) => (
                <option key={month.id} value={month.id}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" className="w-full" onClick={apply}>
            Aplicar período
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  )
}
