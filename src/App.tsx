import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ImportedPeriodProvider } from '@/application/ImportedPeriodProvider'
import { PortfolioOverviewProvider } from '@/application/PortfolioOverviewProvider'
import { ImportDialogProvider } from '@/components/import/ImportDialogProvider'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardPage } from '@/pages/DashboardPage'
import { DataPage } from '@/pages/DataPage'
import { DetailPage } from '@/pages/DetailPage'

export default function App() {
  return (
    <BrowserRouter>
      <ImportedPeriodProvider>
        <PortfolioOverviewProvider>
          <ImportDialogProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="detalle" element={<DetailPage />} />
                <Route path="datos" element={<DataPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </ImportDialogProvider>
        </PortfolioOverviewProvider>
      </ImportedPeriodProvider>
    </BrowserRouter>
  )
}
