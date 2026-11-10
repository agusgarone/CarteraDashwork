import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ExternalFlowFxNotice } from '../components/dashboard/ExternalFlowFxNotice'

it('muestra el retiro nominal y la falta de valuación documental', () => {
  const html = renderToStaticMarkup(
    createElement(ExternalFlowFxNotice, {
      valuation: {
        status: 'PENDING_EXTERNAL_FLOW_FX',
        baseCurrency: 'ARS',
        flows: [
          {
            transactionId: 'flow',
            date: '2026-03-26',
            type: 'WITHDRAWAL',
            amount: '998.71',
            currency: 'USD_MEP',
            reference: 'Comprobante de Pago / referencia-prueba',
            sourceDocumentId: 'document',
            reason: 'MISSING_FX',
          },
        ],
      },
    }),
  )
  expect(html).toContain('998.71 USD MEP')
  expect(html).toContain('2026-03-26')
  expect(html).toContain('Retiro')
  expect(html).toContain('Falta una cotización documental')
  expect(html).toContain('resultado y el rendimiento están pendientes')
})
