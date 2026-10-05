import { cn } from 'cn'
import { SignedDecimal } from '@/components/shared/SignedDecimal'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { InstrumentDetail } from '@/application/portfolioDetail'
import { formatCurrencyARS, formatQuantity } from '@/utils/formatCurrency'

export function InstrumentTable({
  instruments,
  selectedId,
  onSelect,
}: {
  instruments: InstrumentDetail[]
  selectedId: string | null
  onSelect: (instrumentId: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Instrumento</TableHead>
          <TableHead className="text-right">Cantidad</TableHead>
          <TableHead className="text-right">Valor actual</TableHead>
          <TableHead className="text-right">Valor de apertura</TableHead>
          <TableHead className="text-right">Variación de valuación</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {instruments.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
              Ningún instrumento coincide con la búsqueda.
            </TableCell>
          </TableRow>
        ) : (
          instruments.map((instrument) => (
            <TableRow
              key={instrument.id}
              data-state={instrument.id === selectedId ? 'selected' : undefined}
              className={cn('cursor-pointer', instrument.id === selectedId && 'bg-muted/80')}
              onClick={() => onSelect(instrument.id)}
            >
              <TableCell>
                <span className="block font-medium">{instrument.ticker}</span>
                <span className="block text-xs text-muted-foreground">
                  {instrument.name ?? instrument.categoryLabel}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {instrument.quantity ? formatQuantity(instrument.quantity) : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {instrument.currentValue ? formatCurrencyARS(instrument.currentValue) : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {instrument.openingValue ? formatCurrencyARS(instrument.openingValue) : '—'}
              </TableCell>
              <TableCell className="text-right">
                {instrument.valuationChange ? <SignedDecimal value={instrument.valuationChange} /> : '—'}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{instrument.statusLabel ?? '—'}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
