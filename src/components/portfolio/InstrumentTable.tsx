import { cn } from 'cn'
import { SignedAmount } from '@/components/shared/SignedAmount'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Instrument } from '@/types/portfolio'
import { formatCurrency } from '@/utils/formatCurrency'

const quantityFormatter = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function InstrumentTable({
  instruments,
  selectedId,
  onSelect,
}: {
  instruments: Instrument[]
  selectedId: string | null
  onSelect: (instrumentId: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Instrumento</TableHead>
          <TableHead className="text-right">Cantidad</TableHead>
          <TableHead className="text-right">Total actual</TableHead>
          <TableHead className="text-right">Capital invertido</TableHead>
          <TableHead className="text-right">Resultado</TableHead>
          <TableHead className="text-right">Rendimiento %</TableHead>
          <TableHead className="text-right">Ingresos</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {instruments.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
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
                <span className="block text-xs text-muted-foreground">{instrument.name}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {quantityFormatter.format(instrument.quantity)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(instrument.currentValue)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(instrument.investedCapital)}
              </TableCell>
              <TableCell className="text-right">
                <SignedAmount value={instrument.result} />
              </TableCell>
              <TableCell className="text-right">
                <SignedAmount value={instrument.returnPercentage} format="percentage" />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {instrument.income === null ? '—' : formatCurrency(instrument.income)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
