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
import { SignedAmount } from '@/components/shared/SignedAmount'
import type { MonthSnapshot } from '@/types/portfolio'
import { formatCurrency } from '@/utils/formatCurrency'

export function MonthHistory({ months }: { months: MonthSnapshot[] }) {
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
              <TableRow key={month.id}>
                <TableCell className="font-medium">{month.label}</TableCell>
                <TableCell>
                  {month.status === 'complete' ? (
                    <Badge variant="secondary">Completo</Badge>
                  ) : (
                    <Badge variant="outline">Sin datos</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {month.endValue === null ? '—' : formatCurrency(month.endValue)}
                </TableCell>
                <TableCell className="text-right">
                  {month.netContributions === null ? '—' : <SignedAmount value={month.netContributions} />}
                </TableCell>
                <TableCell className="text-right">
                  {month.investmentResult === null ? '—' : <SignedAmount value={month.investmentResult} />}
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
