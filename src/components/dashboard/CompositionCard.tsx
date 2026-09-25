import { CompositionDonut } from '@/components/charts/CompositionDonut'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Category } from '@/types/portfolio'

export function CompositionCard({ categories }: { categories: Category[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Composición actual</CardTitle>
      </CardHeader>
      <CardContent>
        <CompositionDonut categories={categories} />
      </CardContent>
    </Card>
  )
}
