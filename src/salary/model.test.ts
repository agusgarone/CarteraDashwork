import { describe, expect, it } from 'vitest'
import {
  addMonths,
  emptyPlan,
  installmentLabel,
  projectPlans,
  resolveMonth,
  rollMonth,
  summarizePlan,
  validatePlan,
  type SalaryPlan,
} from './model'

export function samplePlan(): SalaryPlan {
  return {
    ...emptyPlan('2026-11'),
    exchangeRate: '1500',
    livingAllowance: '10000',
    incomes: [
      {
        id: 'salary',
        name: 'Sueldo',
        gross: '100000',
        currency: 'ARS',
        deductionPercent: '17',
      },
    ],
    expenses: [
      {
        id: 'subscription',
        name: 'Suscripción',
        amount: '20',
        currency: 'USD',
        group: 'CARD',
        cadence: 'RECURRING',
        firstMonth: '2026-11',
        installmentCount: null,
        endMonth: null,
        paid: true,
      },
      {
        id: 'fixed',
        name: 'Servicios',
        amount: '10000',
        currency: 'ARS',
        group: 'FIXED',
        cadence: 'RECURRING',
        firstMonth: '2026-11',
        installmentCount: null,
        endMonth: null,
        paid: false,
      },
      {
        id: 'reserve',
        name: 'Reserva',
        amount: '5000',
        currency: 'ARS',
        group: 'RESERVE',
        cadence: 'RECURRING',
        firstMonth: '2026-11',
        installmentCount: null,
        endMonth: null,
        paid: true,
      },
      {
        id: 'once',
        name: 'Compra única',
        amount: '2000',
        currency: 'ARS',
        group: 'CARD',
        cadence: 'ONCE',
        firstMonth: '2026-11',
        installmentCount: null,
        endMonth: null,
        paid: false,
      },
      {
        id: 'installment',
        name: 'Compra en cuotas',
        amount: '9000',
        currency: 'ARS',
        group: 'CARD',
        cadence: 'INSTALLMENT',
        firstMonth: '2026-09',
        installmentCount: 3,
        endMonth: null,
        paid: true,
      },
    ],
  }
}

describe('presupuesto mensual del sueldo', () => {
  it('descuenta el porcentaje del bruto y separa gastos, reservas y ahorro', () => {
    expect(summarizePlan(samplePlan())).toEqual({
      status: 'AVAILABLE',
      netIncome: '83000.00',
      card: '41000.00',
      fixed: '10000.00',
      reserves: '5000.00',
      committed: '56000.00',
      pending: '12000.00',
      livingAllowance: '10000.00',
      savings: '17000.00',
    })
  })
  it('pagar cambia lo pendiente sin volver a descontar el gasto del ahorro', () => {
    const plan = samplePlan()
    plan.expenses.forEach((expense) => {
      expense.paid = true
    })
    expect(summarizePlan(plan)).toMatchObject({
      pending: '0.00',
      savings: '17000.00',
      committed: '56000.00',
    })
  })
  it('avanza cuotas por calendario y termina compras únicas y últimas cuotas', () => {
    const plan = samplePlan()
    expect(installmentLabel(plan.expenses[4]!, '2026-11')).toBe('Cuota 3/3')
    const december = rollMonth(plan, '2026-12')
    expect(summarizePlan(december)).toMatchObject({
      card: '30000.00',
      pending: '45000.00',
      savings: '28000.00',
    })
    expect(plan.expenses[0]!.paid).toBe(true)
    expect(december.expenses.every((expense) => !expense.paid)).toBe(true)
    expect(december.expenses.map((expense) => expense.id)).toEqual([
      'subscription',
      'fixed',
      'reserve',
    ])
  })
  it('conserva gastos programados y el historial al avanzar de mes', () => {
    const plan = samplePlan()
    plan.expenses.push({
      ...plan.expenses[1]!,
      id: 'future',
      firstMonth: '2027-02',
    })
    const december = rollMonth(plan, '2026-12')
    expect(december.expenses.some((expense) => expense.id === 'future')).toBe(
      true,
    )
    expect(plan.expenses.some((expense) => expense.id === 'installment')).toBe(
      true,
    )
    expect(
      resolveMonth(
        [
          { plan, revision: 1 },
          { plan: december, revision: 1 },
        ],
        '2026-11',
      ).plan,
    ).toEqual(plan)
  })
  it('saltar meses y cruzar el año mantiene el número correcto de cuota', () => {
    const plan = samplePlan()
    plan.expenses[4]!.firstMonth = '2026-11'
    plan.expenses[4]!.installmentCount = 24
    expect(installmentLabel(plan.expenses[4]!, '2027-01')).toBe('Cuota 3/24')
    expect(installmentLabel(plan.expenses[4]!, '2028-10')).toBe('Cuota 24/24')
    expect(installmentLabel(plan.expenses[4]!, '2028-11')).toBe('Finalizado')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
  })
  it('respeta la fecha inicial y el último mes de un recurrente', () => {
    const plan = samplePlan()
    plan.expenses[0]!.endMonth = '2026-11'
    expect(summarizePlan(rollMonth(plan, '2026-12'))).toMatchObject({
      card: '0.00',
    })
    expect(
      resolveMonth([{ plan, revision: 1 }], '2026-10').plan.incomes,
    ).toEqual([])
  })
  it('los meses confirmados conservan sus valores frente a cambios de otro mes', () => {
    const november = samplePlan()
    const december = rollMonth(november, '2026-12')
    december.incomes[0]!.gross = '200000'
    const records = [
      { plan: november, revision: 1 },
      { plan: december, revision: 1 },
    ]
    november.incomes[0]!.gross = '300000'
    const projection = projectPlans(records, november, 3)
    expect(projection[1]!.summary).toMatchObject({ netIncome: '166000.00' })
    expect(projection[2]!.summary).toMatchObject({ netIncome: '166000.00' })
    expect(resolveMonth(records, '2026-11').plan.expenses[0]!.paid).toBe(true)
  })
  it('distingue cotización ausente de un monto cero y admite déficit real', () => {
    const plan = samplePlan()
    plan.exchangeRate = null
    expect(summarizePlan(plan)).toEqual({ status: 'MISSING_FX' })
    plan.expenses = []
    plan.livingAllowance = '90000'
    expect(summarizePlan(plan)).toMatchObject({ savings: '-7000.00' })
  })
  it('aplica descuentos antes del redondeo del ingreso convertido', () => {
    const plan = emptyPlan('2026-11')
    plan.exchangeRate = '1.005'
    plan.incomes = [
      {
        id: 'a',
        name: 'Ingreso USD',
        gross: '1.01',
        currency: 'USD',
        deductionPercent: '17',
      },
    ]
    expect(summarizePlan(plan)).toMatchObject({ netIncome: '0.84' })
  })
  it('mantiene centavos por encima de los enteros seguros de JavaScript', () => {
    const plan = emptyPlan('2026-11')
    plan.incomes = [
      {
        id: 'a',
        name: 'Ingreso',
        gross: '9007199254740993.57',
        currency: 'ARS',
        deductionPercent: '0',
      },
    ]
    plan.livingAllowance = '9007199254740990.32'
    expect(summarizePlan(plan)).toMatchObject({ savings: '3.25' })
  })
  it.each(['-1', 'NaN', '1.000.000', 'Infinity'])(
    'rechaza importes inválidos %s',
    (amount) => {
      const plan = samplePlan()
      plan.expenses[0]!.amount = amount
      expect(() => validatePlan(plan)).toThrow()
    },
  )
  it('rechaza IDs repetidos, cuotas inválidas y descuentos mayores al bruto', () => {
    const plan = samplePlan()
    plan.expenses[1]!.id = plan.expenses[0]!.id
    expect(() => validatePlan(plan)).toThrow()
    plan.expenses = []
    plan.incomes[0]!.deductionPercent = '101'
    expect(() => validatePlan(plan)).toThrow()
  })
})
