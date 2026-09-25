import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ImportDialogProvider } from '@/components/import/ImportDialogProvider'
import { AppShell } from '@/components/layout/AppShell'
import { PeriodProvider } from '@/components/period/PeriodProvider'
import { DashboardPage } from '@/pages/DashboardPage'
import { DetailPage } from '@/pages/DetailPage'

export default function App() {
  return (
    <BrowserRouter>
      <PeriodProvider>
        <ImportDialogProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="detalle" element={<DetailPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ImportDialogProvider>
      </PeriodProvider>
    </BrowserRouter>
  )
}
