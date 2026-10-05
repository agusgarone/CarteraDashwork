import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useImportDialog } from '@/components/import/ImportDialogProvider'
import { SignedDecimal } from '@/components/shared/SignedDecimal'
import type { OverviewMonth } from '@/application/portfolioOverview'
import { formatCurrencyARS } from '@/utils/formatCurrency'

export function MonthHistory({
  months,
  selectedId,
  onSelect,
}: {
  months: OverviewMonth[]
  selectedId: string
  onSelect: (periodId: string) => void
}) {
  const { setOpen } = useImportDialog()

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Historial de meses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mes</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Patrimonio total</TableHead>
              <TableHead className="text-right">Aporte neto</TableHead>
              <TableHead className="text-right">Generado por inversiones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((month) => (
              <TableRow
                key={month.periodId}
                data-state={month.periodId === selectedId ? 'selected' : undefined}
                className="cursor-pointer"
                onClick={() => onSelect(month.periodId)}
              >
                <TableCell className="font-medium">{month.label}</TableCell>
                <TableCell>
                  <Badge variant="secondary">Completo</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {month.closingValue === null ? '—' : formatCurrencyARS(month.closingValue)}
                </TableCell>
                <TableCell className="text-right">
                  {month.netContributions === null ? '—' : <SignedDecimal value={month.netContributions} />}
                </TableCell>
                <TableCell className="text-right">
                  {month.investmentResult === null ? '—' : <SignedDecimal value={month.investmentResult} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Importar nuevo mes
        </Button>
      </CardContent>
    </Card>
  )
}
