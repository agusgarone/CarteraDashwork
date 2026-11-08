import { useEffect, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatCurrencyARS } from '@/utils/formatCurrency'
import {
  addMonths,
  amountInArs,
  endsThisMonth,
  groupLabels,
  installmentLabel,
  isActive,
  monthLabel,
  projectPlans,
  resolveMonth,
  type SalaryExpense,
  type SalaryPlan,
  type SavedSalaryMonth,
} from './model'
import { salaryRepository } from './repository'
import { IncomeForm, ExpenseForm, Field } from './SalaryForms'
import { SalarySummary } from './SalarySummary'

type Editor =
  | { kind: 'income' }
  | { kind: 'expense'; expense?: SalaryExpense }
  | { kind: 'remove'; expense: SalaryExpense }
const currentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
export function SalaryPage() {
  const [month, setMonth] = useState(currentMonth)
  const [records, setRecords] = useState<SavedSalaryMonth[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [horizon, setHorizon] = useState(6)
  const mounted = useRef(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    mounted.current = true
    let cancelled = false
    void salaryRepository
      .list()
      .then((rows) => {
        if (!cancelled) {
          setLoadFailed(false)
          setRecords(rows)
          setError(null)
          setLoading(false)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setLoadFailed(true)
          setError(errorMessage(cause))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [attempt])
  const resolved = resolveMonth(records, month)
  const { plan } = resolved
  async function persist(next: SalaryPlan) {
    setBusy(true)
    setError(null)
    try {
      const saved = await salaryRepository.save(next, resolved.revision)
      if (mounted.current) {
        setRecords((rows) =>
          rows
            .filter((row) => row.plan.month !== saved.plan.month)
            .concat(saved),
        )
        setEditor(null)
      }
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const run = (next: SalaryPlan) => {
    void persist(next).catch((cause) => {
      if (mounted.current) setError(errorMessage(cause))
    })
  }
  if (loading)
    return (
      <div role="status" className="space-y-4">
        <h1 className="text-2xl font-semibold">Sueldo y gastos</h1>
        <p>Cargando tus presupuestos…</p>
      </div>
    )
  if (loadFailed)
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Sueldo y gastos</h1>
        <p role="alert">{error}</p>
        <Button
          onClick={() => {
            setLoading(true)
            setAttempt((value) => value + 1)
          }}
        >
          Volver a cargar
        </Button>
      </div>
    )
  const projection = projectPlans(records, plan, horizon)
  const active = plan.expenses.filter((expense) => isActive(expense, month))
  const upcoming = plan.expenses.filter((expense) => expense.firstMonth > month)
  function rows(expenses: SalaryExpense[]) {
    return expenses.map((expense) => {
      const activeNow = isActive(expense, month)
      const amount = amountInArs(
        expense.amount,
        expense.currency,
        plan.exchangeRate,
      )
      return (
        <tr
          key={expense.id}
          className={`border-b border-border last:border-0 ${activeNow ? '' : 'text-muted-foreground'}`}
        >
          <td className="p-3">
            <p className="font-medium">{expense.name}</p>
            <p className="text-xs text-muted-foreground">
              {groupLabels[expense.group]}
              {expense.currency === 'USD' ? ` · USD ${expense.amount}` : ''}
            </p>
          </td>
          <td className="whitespace-nowrap p-3 text-right tabular-nums">
            {amount === null ? 'Falta cotización' : formatCurrencyARS(amount)}
          </td>
          <td className="p-3 text-sm">
            <p>{installmentLabel(expense, month)}</p>
            {endsThisMonth(expense, month) && (
              <span className="text-xs text-positive">Termina este mes</span>
            )}
          </td>
          <td className="p-3">
            <label className="inline-flex items-center gap-2 whitespace-nowrap text-sm">
              <input
                type="checkbox"
                checked={activeNow && expense.paid}
                disabled={busy || !activeNow}
                onChange={(event) =>
                  run({
                    ...plan,
                    expenses: plan.expenses.map((row) =>
                      row.id === expense.id
                        ? { ...row, paid: event.target.checked }
                        : row,
                    ),
                  })
                }
              />
              <span>{expense.group === 'RESERVE' ? 'Separado' : 'Pagado'}</span>
            </label>
          </td>
          <td className="p-3">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditor({ kind: 'expense', expense })}
              >
                Editar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditor({ kind: 'remove', expense })}
              >
                Finalizar
              </Button>
            </div>
          </td>
        </tr>
      )
    })
  }
  return (
    <div className="space-y-6" aria-busy={busy}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Sueldo y gastos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organizá tus compromisos, lo que reservás para el mes y tu ahorro
            previsto. Importes en pesos.
          </p>
        </div>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => setEditor({ kind: 'income' })}>
            Ingresos y presupuesto
          </Button>
        </div>
      </header>
      <section className="flex flex-wrap items-end gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setMonth(addMonths(month, -1))}
        >
          Anterior
        </Button>
        <Field label="Mes del presupuesto">
          <Input
            type="month"
            required
            value={month}
            disabled={busy}
            onChange={(event) => {
              if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value))
                setMonth(event.target.value)
            }}
          />
        </Field>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          Siguiente
        </Button>
        <p className="pb-1 text-sm text-muted-foreground">
          {resolved.revision !== null
            ? 'Mes guardado'
            : resolved.sourceMonth
              ? `Proyección desde ${monthLabel(resolved.sourceMonth)}`
              : 'Nuevo presupuesto'}
        </p>
        {resolved.revision === null &&
          (plan.incomes.length > 0 || plan.expenses.length > 0) && (
            <Button disabled={busy} onClick={() => run(plan)}>
              Guardar este mes
            </Button>
          )}
      </section>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-negative/5 p-3 text-sm"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Volver a cargar
          </Button>
        </div>
      )}
      {!plan.incomes.length && !plan.expenses.length ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <h2 className="text-lg font-medium">Prepará tu primer mes</h2>
            <p className="text-sm text-muted-foreground">
              Cargá tus ingresos y cuánto querés reservar para vivir durante el
              mes. Después agregá tus gastos fijos, reservas y compras en
              cuotas. Los compromisos vigentes se trasladan al mes siguiente
              automáticamente.
            </p>
            <Button
              disabled={busy}
              onClick={() => setEditor({ kind: 'income' })}
            >
              Crear presupuesto
            </Button>
          </CardContent>
        </Card>
      ) : (
        <SalarySummary plan={plan} />
      )}
      {resolved.revision === null && resolved.sourceMonth && (
        <p className="text-sm text-muted-foreground">
          Esta proyección usa los ingresos, importes y cotización del último mes
          guardado. Podés ajustarlos antes de confirmar el mes. Los pagos
          comienzan pendientes.
        </p>
      )}
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">
              Compromisos de {monthLabel(month)}
            </h2>
            <Button
              disabled={busy}
              onClick={() => setEditor({ kind: 'expense' })}
            >
              Agregar compromiso
            </Button>
          </div>
          {active.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="p-3">Concepto</th>
                    <th className="p-3 text-right">Importe del mes</th>
                    <th className="p-3">Frecuencia</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>{rows(active)}</tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Este mes todavía no tiene compromisos vigentes.
            </p>
          )}
          {upcoming.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Próximos compromisos ({upcoming.length})
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <tbody>{rows(upcoming)}</tbody>
                </table>
              </div>
            </details>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Próximos meses</h2>
            <label className="flex items-center gap-2 text-sm">
              Proyectar
              <select
                className="rounded-md border border-input bg-card p-1"
                value={horizon}
                onChange={(event) => setHorizon(Number(event.target.value))}
              >
                <option value={3}>3 meses</option>
                <option value={6}>6 meses</option>
                <option value={12}>12 meses</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="p-2">Mes</th>
                  <th className="p-2 text-right">Ingresos netos</th>
                  <th className="p-2 text-right">Compromisos</th>
                  <th className="p-2 text-right">Para el mes</th>
                  <th className="p-2 text-right">Ahorro previsto</th>
                </tr>
              </thead>
              <tbody>
                {projection.map((row) => (
                  <tr key={row.month} className="border-t border-border">
                    <td className="p-2">
                      <button
                        className="text-left underline-offset-4 hover:underline"
                        disabled={busy}
                        onClick={() => setMonth(row.month)}
                      >
                        {monthLabel(row.month)}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {row.saved ? 'Guardado' : 'Proyectado'}
                      </p>
                    </td>
                    {row.summary.status === 'AVAILABLE' ? (
                      [
                        row.summary.netIncome,
                        row.summary.committed,
                        row.summary.livingAllowance,
                        row.summary.savings,
                      ].map((value, index) => (
                        <td
                          key={index}
                          className={`p-2 text-right tabular-nums ${value.startsWith('-') ? 'text-negative' : ''}`}
                        >
                          {formatCurrencyARS(value)}
                        </td>
                      ))
                    ) : (
                      <td colSpan={4} className="p-2 text-right">
                        Falta cotización USD
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Las cuotas finalizadas salen de los compromisos. Cada mes guardado
            conserva sus propios valores.
          </p>
        </CardContent>
      </Card>
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setEditor(null)
            setError(null)
          }
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editor?.kind === 'income'
                ? 'Ingresos y presupuesto'
                : editor?.kind === 'remove'
                  ? 'Finalizar compromiso'
                  : 'Compromiso mensual'}
            </DialogTitle>
            <DialogDescription>
              {`Presupuesto de ${monthLabel(month)}`}
            </DialogDescription>
          </DialogHeader>
          {editor?.kind === 'income' && (
            <IncomeForm plan={plan} busy={busy} onSave={persist} />
          )}
          {editor?.kind === 'expense' && (
            <ExpenseForm
              plan={plan}
              expense={editor.expense}
              busy={busy}
              onSave={persist}
            />
          )}
          {editor?.kind === 'remove' && (
            <div className="space-y-4">
              <p className="text-sm">
                {editor.expense.name} dejará de incluirse desde{' '}
                {monthLabel(month)}
                en este presupuesto y sus proyecciones. Los otros meses
                guardados conservan sus datos. Si todavía corresponde pagarlo
                este mes, editá su último mes en lugar de finalizarlo ahora.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  run({
                    ...plan,
                    expenses: plan.expenses.filter(
                      (row) => row.id !== editor.expense.id,
                    ),
                  })
                }
              >
                Confirmar y guardar
              </Button>
            </div>
          )}
          {editor?.kind === 'remove' && error && (
            <p role="alert" className="text-negative">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : 'No se pudo leer o guardar el presupuesto.'
}
