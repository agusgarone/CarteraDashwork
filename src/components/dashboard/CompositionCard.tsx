import { CompositionDonut } from '@/components/charts/CompositionDonut'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PortfolioOverviewView } from '@/application/portfolioOverview'

export function CompositionCard({ overview }: { overview: PortfolioOverviewView }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Composición actual</CardTitle>
      </CardHeader>
      <CardContent>
        <CompositionDonut allocation={overview.allocation} residual={overview.allocationResidual} />
      </CardContent>
    </Card>
  )
}
