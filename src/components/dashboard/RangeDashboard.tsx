import type { ReactNode } from 'react'
import type { RangeAnalysisResult } from '@/analysis/rangeAnalysisService'
import { rangePeriodLabel } from '@/analysis/analysisRange'
import { useDisplayCurrency } from '@/presentation/DisplayCurrencyProvider'
import { formatReturnPercent } from '@/utils/formatPercentage'
import { PortfolioEvolutionChart } from '@/components/charts/PortfolioEvolutionChart'
import { Card, CardContent } from '@/components/ui/card'
export function RangeDashboard({ result, loading, error, controls }: { result: RangeAnalysisResult | null; loading: boolean; error: string | null; controls: ReactNode }) {
  const display = useDisplayCurrency()
  let content: ReactNode
  if (loading) content = <p role="status">Calculando el rango…</p>
  else if (error) content = <p role="alert">No se pudo analizar el rango: {error}</p>
  else if (result?.status === 'INCOMPLETE_RANGE') content = <p role="alert">Rango incompleto. Faltan períodos importados: {result.missingPeriods.join(', ')}.</p>
  else if (!result || result.status !== 'AVAILABLE') content = <p role="alert">Rango no disponible. Revisá que el inicio sea anterior o igual al final y que existan los snapshots de apertura y cierre.</p>
  else if (display.requestedCurrency === 'USD' && (display.loading || display.periodId !== result.range.endPeriodId)) content = <p role="status">Consultando referencia USD del período final…</p>
  else {
    const { base, periodReturn } = result
    const metrics = [
      ['Patrimonio inicial', display.format(base.openingValue)], ['Patrimonio final', display.format(base.closingValue)],
      ['Aportes', display.format(base.contributions)], ['Retiros', display.format(base.withdrawals)],
      ['Flujo externo neto', display.signed(base.netContributions)], ['Resultado de inversiones', display.signed(base.investmentResult)],
      ['Rendimiento Modified Dietz', periodReturn.status === 'CALCULATED' ? formatReturnPercent(periodReturn.returnDecimal) : 'No disponible: capital ponderado no positivo'],
    ]
    content = <>
      <div><h2 className="text-xl font-semibold">{rangePeriodLabel(result.periods[0]!)} → {rangePeriodLabel(result.periods[result.periods.length - 1]!)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{result.openingSnapshot.date} → {result.closingSnapshot.date} · {result.durationDays} días · {result.periods.length} períodos</p></div>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(([label, value]) => <Card key={label}><CardContent className="space-y-2 py-5"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p></CardContent></Card>)}</section>
      <p className="text-sm text-muted-foreground">El rendimiento considera la fecha real de cada aporte y retiro en toda la ventana; no está anualizado.</p>
      <Card><CardContent className="space-y-4 py-5"><h2 className="font-medium">Evolución de tu cartera en el rango</h2><PortfolioEvolutionChart points={result.evolution} />
        <p className="text-xs text-muted-foreground">Patrimonio de cierre de cada período. En USD, todos los puntos e importes usan la referencia MEP del período final.</p></CardContent></Card>
      <Card><CardContent className="space-y-2 py-5"><h2 className="font-medium">Atribución del rango pendiente</h2><p className="text-sm text-muted-foreground">El resultado global está calculado. La explicación por instrumento para varios períodos requiere un análisis adicional. El detalle continúa mostrando el mes final seleccionado.</p></CardContent></Card>
    </>
  }
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Análisis de tu cartera</h1>{controls}{content}</div>
}
