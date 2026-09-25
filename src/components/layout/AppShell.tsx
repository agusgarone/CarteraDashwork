import { NavLink, Outlet } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { cn } from 'cn'
import { ImportMonthDialog } from '@/components/import/ImportMonthDialog'
import { useImportDialog } from '@/components/import/ImportDialogProvider'
import { PeriodSelector } from '@/components/period/PeriodSelector'
import { Button } from '@/components/ui/button'
import { getLastLoadLabel } from '@/services/portfolioService'

const links = [
  { to: '/', label: 'Resumen', end: true },
  { to: '/detalle', label: 'Detalle', end: false },
]

export function AppShell() {
  const { setOpen } = useImportDialog()

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3 lg:px-10">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-[11px] font-semibold text-background">
                P
              </span>
              <span className="text-sm font-semibold tracking-tight">Portfolio</span>
            </div>
            <nav className="flex items-center gap-1">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors',
                      isActive && 'bg-muted font-medium text-foreground',
                    )
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <PeriodSelector />
            <p className="text-xs text-muted-foreground">
              Última carga: <span className="text-foreground">{getLastLoadLabel()}</span>
            </p>
            <Button type="button" onClick={() => setOpen(true)}>
              <Upload />
              Importar mes
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-6 py-8 lg:px-10">
        <Outlet />
      </main>
      <ImportMonthDialog />
    </div>
  )
}
