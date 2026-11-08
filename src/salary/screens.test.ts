import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SalarySummary } from './SalarySummary'
import { emptyPlan } from './model'

describe('presentación del presupuesto', () => {
  it('identifica el ahorro estimado y lo pendiente de pago', () => {
    const plan = emptyPlan('2026-11')
    plan.incomes = [
      {
        id: 'salary',
        name: 'Sueldo',
        gross: '100000',
        deductionPercent: '17',
        currency: 'ARS',
      },
    ]
    plan.livingAllowance = '10000'
    const html = renderToStaticMarkup(createElement(SalarySummary, { plan }))
    expect(html).toContain('Ahorro previsto')
    expect(html).toContain('$73.000,00')
    expect(html).toContain('Pendiente de pagar o separar')
  })
  it('una cotización ausente se presenta como dato requerido', () => {
    const plan = emptyPlan('2026-11')
    plan.incomes = [
      {
        id: 'salary',
        name: 'Sueldo',
        gross: '100',
        deductionPercent: '0',
        currency: 'USD',
      },
    ]
    const html = renderToStaticMarkup(createElement(SalarySummary, { plan }))
    expect(html).toContain('Completá la cotización')
    expect(html).not.toContain('Ahorro previsto')
  })
})
