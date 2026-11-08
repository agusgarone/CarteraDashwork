import { formatBudgetNumber, parseBudgetNumber } from './numberInput'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  groupLabels,
  validatePlan,
  type SalaryPlan,
  type SalaryIncome,
  type SalaryExpense,
} from './model'

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-card px-2 text-sm'
export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span>{label}</span>
      {children}
    </label>
  )
}
export function IncomeForm({
  plan,
  busy,
  onSave,
}: {
  plan: SalaryPlan
  busy: boolean
  onSave: (plan: SalaryPlan) => Promise<void>
}) {
  const [incomes, setIncomes] = useState<SalaryIncome[]>(
    plan.incomes.length
      ? plan.incomes.map((income) => ({
          ...income,
          gross: formatBudgetNumber(income.gross),
          deductionPercent: formatBudgetNumber(income.deductionPercent),
        }))
      : [
          {
            id: crypto.randomUUID(),
            name: 'Sueldo',
            gross: '',
            currency: 'ARS',
            deductionPercent: '17',
          },
        ],
  )
  const [error, setError] = useState<string | null>(null)
  function change(id: string, field: keyof SalaryIncome, value: string) {
    setIncomes((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    )
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const data = new FormData(event.currentTarget)
    try {
      const next = {
        ...plan,
        incomes: incomes.map((row) => ({
          ...row,
          name: row.name.trim(),
          gross: parseBudgetNumber(row.gross),
          deductionPercent: parseBudgetNumber(row.deductionPercent),
        })),
        livingAllowance: parseBudgetNumber(String(data.get('allowance'))),
        exchangeRate: String(data.get('rate')).trim()
          ? parseBudgetNumber(String(data.get('rate')))
          : null,
      }
      validatePlan(next)
      await onSave(next)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo guardar el mes.',
      )
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <fieldset disabled={busy} className="space-y-4">
        {incomes.map((row) => (
          <div
            key={row.id}
            className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
          >
            <Field label="Ingreso">
              <Input
                required
                maxLength={200}
                value={row.name}
                onChange={(event) => change(row.id, 'name', event.target.value)}
              />
            </Field>
            <Field label="Importe bruto">
              <Input
                required
                inputMode="decimal"
                value={row.gross}
                onChange={(event) =>
                  change(row.id, 'gross', event.target.value)
                }
              />
            </Field>
            <Field label="Moneda">
              <select
                className={selectClass}
                value={row.currency}
                onChange={(event) =>
                  change(row.id, 'currency', event.target.value)
                }
              >
                <option value="ARS">Pesos</option>
                <option value="USD">Dólares</option>
              </select>
            </Field>
            <Field label="Descuentos (%)">
              <Input
                required
                inputMode="decimal"
                value={row.deductionPercent}
                onChange={(event) =>
                  change(row.id, 'deductionPercent', event.target.value)
                }
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setIncomes((rows) => rows.filter((item) => item.id !== row.id))
              }
            >
              Quitar ingreso
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setIncomes((rows) => [
              ...rows,
              {
                id: crypto.randomUUID(),
                name: '',
                gross: '',
                currency: 'ARS',
                deductionPercent: '0',
              },
            ])
          }
        >
          Agregar ingreso
        </Button>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dinero para gastar durante el mes (ARS)">
            <Input
              name="allowance"
              required
              inputMode="decimal"
              defaultValue={formatBudgetNumber(plan.livingAllowance)}
            />
          </Field>
          <Field label="Cotización de presupuesto (ARS por USD)">
            <Input
              name="rate"
              inputMode="decimal"
              defaultValue={formatBudgetNumber(plan.exchangeRate ?? '')}
              placeholder="Necesaria para importes en USD"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Ingresá importes sin separadores de miles y con coma decimal. El
          descuento del sueldo se puede ajustar cada mes.
        </p>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <Button disabled={busy} type="submit">
        {busy ? 'Guardando…' : 'Guardar ingresos y presupuesto'}
      </Button>
    </form>
  )
}
export function ExpenseForm({
  plan,
  expense,
  busy,
  onSave,
}: {
  plan: SalaryPlan
  expense?: SalaryExpense
  busy: boolean
  onSave: (plan: SalaryPlan) => Promise<void>
}) {
  const [cadence, setCadence] = useState<SalaryExpense['cadence']>(
    expense?.cadence ?? 'RECURRING',
  )
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const data = new FormData(event.currentTarget)
    try {
      const nextExpense: SalaryExpense = {
        id: expense?.id ?? crypto.randomUUID(),
        name: String(data.get('name')).trim(),
        amount: parseBudgetNumber(String(data.get('amount'))),
        currency: String(data.get('currency')) as SalaryExpense['currency'],
        group: String(data.get('group')) as SalaryExpense['group'],
        cadence,
        firstMonth: String(data.get('firstMonth')),
        installmentCount:
          cadence === 'INSTALLMENT' ? Number(data.get('count')) : null,
        endMonth: String(data.get('endMonth') ?? '').trim() || null,
        paid: expense?.paid ?? false,
      }
      const next = {
        ...plan,
        expenses: expense
          ? plan.expenses.map((row) =>
              row.id === expense.id ? nextExpense : row,
            )
          : [...plan.expenses, nextExpense],
      }
      validatePlan(next)
      await onSave(next)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo guardar el compromiso.',
      )
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <Field label="Concepto">
          <Input
            name="name"
            required
            maxLength={200}
            defaultValue={expense?.name ?? ''}
          />
        </Field>
        <Field label="Importe mensual o de cada cuota">
          <Input
            name="amount"
            required
            inputMode="decimal"
            defaultValue={formatBudgetNumber(expense?.amount ?? '')}
          />
        </Field>
        <Field label="Moneda">
          <select
            name="currency"
            className={selectClass}
            defaultValue={expense?.currency ?? 'ARS'}
          >
            <option value="ARS">Pesos</option>
            <option value="USD">Dólares</option>
          </select>
        </Field>
        <Field label="Grupo">
          <select
            name="group"
            className={selectClass}
            defaultValue={expense?.group ?? 'CARD'}
          >
            {Object.entries(groupLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Frecuencia">
          <select
            className={selectClass}
            value={cadence}
            onChange={(event) =>
              setCadence(event.target.value as SalaryExpense['cadence'])
            }
          >
            <option value="RECURRING">Todos los meses</option>
            <option value="INSTALLMENT">Compra en cuotas</option>
            <option value="ONCE">Una sola vez</option>
          </select>
        </Field>
        <Field
          label={
            cadence === 'INSTALLMENT' ? 'Mes de la primera cuota' : 'Primer mes'
          }
        >
          <Input
            name="firstMonth"
            type="month"
            required
            defaultValue={expense?.firstMonth ?? plan.month}
          />
        </Field>
        {cadence === 'INSTALLMENT' && (
          <Field label="Cantidad total de cuotas">
            <Input
              name="count"
              type="number"
              min={1}
              max={600}
              required
              defaultValue={expense?.installmentCount ?? 3}
            />
          </Field>
        )}
        <Field label="Último mes, si corresponde">
          <Input
            name="endMonth"
            type="month"
            defaultValue={expense?.endMonth ?? ''}
          />
        </Field>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        El número de cuota se calcula a partir del primer mes. Los cambios se
        aplican a este presupuesto y sus proyecciones.
      </p>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <Button disabled={busy} type="submit">
        {busy ? 'Guardando…' : 'Guardar compromiso'}
      </Button>
    </form>
  )
}
