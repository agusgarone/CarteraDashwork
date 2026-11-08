import Decimal from 'decimal.js'

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })
export type SalaryCurrency = 'ARS' | 'USD'
export type ExpenseGroup = 'CARD' | 'FIXED' | 'RESERVE'
export type ExpenseCadence = 'RECURRING' | 'INSTALLMENT' | 'ONCE'
export interface SalaryIncome {
  id: string
  name: string
  gross: string
  currency: SalaryCurrency
  deductionPercent: string
}
export interface SalaryExpense {
  id: string
  name: string
  amount: string
  currency: SalaryCurrency
  group: ExpenseGroup
  cadence: ExpenseCadence
  firstMonth: string
  installmentCount: number | null
  endMonth: string | null
  paid: boolean
}
export interface SalaryPlan {
  version: 1
  month: string
  incomes: SalaryIncome[]
  exchangeRate: string | null
  livingAllowance: string
  expenses: SalaryExpense[]
}
export interface SavedSalaryMonth {
  plan: SalaryPlan
  revision: number
}
export const groupLabels: Record<ExpenseGroup, string> = {
  CARD: 'Tarjetas y cuotas',
  FIXED: 'Gastos fijos',
  RESERVE: 'Reservas',
}

export function monthIndex(month: string): number {
  if (typeof month !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error('Elegí un mes válido.')
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1
}
export function addMonths(month: string, count: number): string {
  const index = monthIndex(month) + count
  const result = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
  monthIndex(result)
  return result
}
export function monthLabel(month: string): string {
  monthIndex(month)
  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`))
}
export function decimalInput(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 50 ||
    !/^\d+(?:[.,]\d{1,8})?$/.test(value.trim())
  ) {
    throw new Error(
      'Ingresá un importe positivo o cero, sin separadores de miles.',
    )
  }
  return new Money(value.trim().replace(',', '.')).toFixed()
}
function checkName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    throw new Error('Completá un nombre de hasta 200 caracteres.')
}
function checkCurrency(value: unknown) {
  if (value !== 'ARS' && value !== 'USD')
    throw new Error('La moneda debe ser ARS o USD.')
}
function checkIds(items: { id: string }[]) {
  const ids = new Set<string>()
  for (const item of items) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      item.id.length > 80 ||
      ids.has(item.id)
    )
      throw new Error('Hay identificadores de conceptos inválidos o repetidos.')
    ids.add(item.id)
  }
}
export function validatePlan(value: unknown): asserts value is SalaryPlan {
  if (!value || typeof value !== 'object')
    throw new Error('El presupuesto no es válido.')
  const plan = value as SalaryPlan
  if (plan.version !== 1)
    throw new Error('La versión del presupuesto no es compatible.')
  monthIndex(plan.month)
  if (
    !Array.isArray(plan.incomes) ||
    !Array.isArray(plan.expenses) ||
    plan.incomes.length > 30 ||
    plan.expenses.length > 500
  )
    throw new Error('La cantidad de conceptos no es válida.')
  checkIds(plan.incomes)
  checkIds(plan.expenses)
  decimalInput(plan.livingAllowance)
  if (
    plan.exchangeRate !== null &&
    !new Money(decimalInput(plan.exchangeRate)).gt(0)
  )
    throw new Error('La cotización USD debe ser mayor a cero.')
  for (const income of plan.incomes) {
    checkName(income.name)
    checkCurrency(income.currency)
    decimalInput(income.gross)
    if (new Money(decimalInput(income.deductionPercent)).gt(100))
      throw new Error('Los descuentos deben estar entre 0 y 100 %.')
  }
  for (const expense of plan.expenses) {
    checkName(expense.name)
    checkCurrency(expense.currency)
    decimalInput(expense.amount)
    monthIndex(expense.firstMonth)
    if (
      !['CARD', 'FIXED', 'RESERVE'].includes(expense.group) ||
      !['RECURRING', 'INSTALLMENT', 'ONCE'].includes(expense.cadence) ||
      typeof expense.paid !== 'boolean'
    )
      throw new Error('El tipo o estado del compromiso no es válido.')
    if (
      expense.cadence === 'INSTALLMENT' &&
      (!Number.isInteger(expense.installmentCount) ||
        expense.installmentCount! < 1 ||
        expense.installmentCount! > 600)
    )
      throw new Error('La cantidad de cuotas debe estar entre 1 y 600.')
    if (expense.cadence !== 'INSTALLMENT' && expense.installmentCount !== null)
      throw new Error('Revisá la cantidad de cuotas.')
    if (
      expense.endMonth !== null &&
      monthIndex(expense.endMonth) < monthIndex(expense.firstMonth)
    )
      throw new Error('El último mes debe ser posterior o igual al primero.')
  }
}
export function emptyPlan(month: string): SalaryPlan {
  monthIndex(month)
  return {
    version: 1,
    month,
    incomes: [],
    expenses: [],
    exchangeRate: null,
    livingAllowance: '0',
  }
}
export function isActive(expense: SalaryExpense, month: string): boolean {
  const elapsed = monthIndex(month) - monthIndex(expense.firstMonth)
  if (
    elapsed < 0 ||
    (expense.endMonth && monthIndex(month) > monthIndex(expense.endMonth))
  )
    return false
  if (expense.cadence === 'ONCE') return elapsed === 0
  return expense.cadence === 'RECURRING' || elapsed < expense.installmentCount!
}
export function installmentLabel(
  expense: SalaryExpense,
  month: string,
): string {
  if (monthIndex(month) < monthIndex(expense.firstMonth))
    return `Desde ${monthLabel(expense.firstMonth)}`
  if (!isActive(expense, month)) return 'Finalizado'
  if (expense.cadence === 'INSTALLMENT')
    return `Cuota ${monthIndex(month) - monthIndex(expense.firstMonth) + 1}/${expense.installmentCount}`
  return expense.cadence === 'ONCE' ? 'Solo este mes' : 'Mensual'
}
export function endsThisMonth(expense: SalaryExpense, month: string): boolean {
  return isActive(expense, month) && !isActive(expense, addMonths(month, 1))
}
export function rollMonth(plan: SalaryPlan, month: string): SalaryPlan {
  monthIndex(month)
  return {
    ...structuredClone(plan),
    month,
    expenses: plan.expenses
      .filter(
        (expense) =>
          month === plan.month ||
          expense.firstMonth > month ||
          isActive(expense, month),
      )
      .map((expense) => ({
        ...expense,
        paid: month === plan.month ? expense.paid : false,
      })),
  }
}
export function resolveMonth(records: SavedSalaryMonth[], month: string) {
  monthIndex(month)
  const previous = records
    .filter((record) => record.plan.month <= month)
    .sort((a, b) => b.plan.month.localeCompare(a.plan.month))[0]
  if (!previous)
    return { plan: emptyPlan(month), revision: null, sourceMonth: null }
  const exact = previous.plan.month === month
  return {
    plan: rollMonth(previous.plan, month),
    revision: exact ? previous.revision : null,
    sourceMonth: previous.plan.month,
  }
}
function convertedAmount(
  amount: string,
  currency: SalaryCurrency,
  rate: string | null,
) {
  if (currency === 'USD' && !rate) return null
  return new Money(decimalInput(amount)).mul(
    currency === 'USD' ? decimalInput(rate!) : '1',
  )
}
export function amountInArs(
  amount: string,
  currency: SalaryCurrency,
  rate: string | null,
): string | null {
  return convertedAmount(amount, currency, rate)?.toFixed(2) ?? null
}
export function summarizePlan(plan: SalaryPlan) {
  validatePlan(plan)
  const active = plan.expenses.filter((expense) =>
    isActive(expense, plan.month),
  )
  if (
    !plan.exchangeRate &&
    (plan.incomes.some((income) => income.currency === 'USD') ||
      active.some((expense) => expense.currency === 'USD'))
  )
    return { status: 'MISSING_FX' as const }
  const netIncome = plan.incomes.reduce(
    (sum, income) =>
      sum.plus(
        convertedAmount(income.gross, income.currency, plan.exchangeRate)!
          .mul(
            new Money(1).minus(
              new Money(decimalInput(income.deductionPercent)).div(100),
            ),
          )
          .toDecimalPlaces(2),
      ),
    new Money(0),
  )
  const groups = {
    CARD: new Money(0),
    FIXED: new Money(0),
    RESERVE: new Money(0),
  }
  let pending = new Money(0)
  for (const expense of active) {
    const amount = new Money(
      amountInArs(expense.amount, expense.currency, plan.exchangeRate)!,
    )
    groups[expense.group] = groups[expense.group].plus(amount)
    if (!expense.paid) pending = pending.plus(amount)
  }
  const committed = groups.CARD.plus(groups.FIXED).plus(groups.RESERVE)
  return {
    status: 'AVAILABLE' as const,
    netIncome: netIncome.toFixed(2),
    card: groups.CARD.toFixed(2),
    fixed: groups.FIXED.toFixed(2),
    reserves: groups.RESERVE.toFixed(2),
    committed: committed.toFixed(2),
    pending: pending.toFixed(2),
    livingAllowance: new Money(decimalInput(plan.livingAllowance)).toFixed(2),
    savings: netIncome
      .minus(committed)
      .minus(decimalInput(plan.livingAllowance))
      .toFixed(2),
  }
}
export function projectPlans(
  records: SavedSalaryMonth[],
  current: SalaryPlan,
  count: number,
) {
  if (![3, 6, 12].includes(count))
    throw new Error('Elegí una proyección de 3, 6 o 12 meses.')
  const effective = records
    .filter((record) => record.plan.month !== current.month)
    .concat({ plan: current, revision: 1 })
  return Array.from({ length: count }, (_, index) => {
    const month = addMonths(current.month, index)
    const resolved = resolveMonth(effective, month)
    return {
      month,
      saved: records.some((record) => record.plan.month === month),
      summary: summarizePlan(resolved.plan),
    }
  })
}
