import Decimal from 'decimal.js'
import type { CurrencyCode } from '../../domain/currency'
import type { Transaction } from '../../domain/transaction'
import type { StoredTransactionFx } from '../../repositories/transactionFxRepository'
import { resolveExternalFlowAmount } from './externalFlows'
import { AnalysisError } from '../errors/analysisErrors'
import { parseDecimal } from '../money'

const ValuationDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
})

export interface ExternalFlowBaseValuation {
  transactionId: string
  date: string
  amount: string
  currency: CurrencyCode
  amountBase: string
  baseCurrency: CurrencyCode
  fxRate: string
  fxKind: 'IDENTITY' | 'TRANSACTION' | StoredTransactionFx['fxKind']
  provenance: {
    sourceDocumentId: string | null
    reference: string | null
    enrichment?: StoredTransactionFx
  }
}
export interface PendingExternalFlow {
  transactionId: string
  date: string
  type: 'CONTRIBUTION' | 'WITHDRAWAL'
  amount: string
  currency: CurrencyCode
  reference: string | null
  sourceDocumentId: string | null
  reason: 'MISSING_FX' | 'INVALID_FX' | 'UNSUPPORTED_FX' | 'MISSING_PROVENANCE'
}
export interface PendingExternalFlowFx {
  status: 'PENDING_EXTERNAL_FLOW_FX'
  baseCurrency: CurrencyCode
  flows: PendingExternalFlow[]
}
export class PendingExternalFlowFxError extends AnalysisError {
  readonly status = 'PENDING_EXTERNAL_FLOW_FX'
  readonly pending: PendingExternalFlowFx
  readonly openingValue: string
  readonly closingValue: string
  constructor(
    pending: PendingExternalFlowFx,
    openingValue: string,
    closingValue: string,
  ) {
    super(
      'Falta una valuación documental en moneda base para aportes o retiros del período.',
    )
    this.name = 'PendingExternalFlowFxError'
    this.pending = pending
    this.openingValue = openingValue
    this.closingValue = closingValue
  }
}

/** Rates are historical ARS per nominal unit. Display and snapshot FX are excluded. */
export function valueExternalFlows(
  transactions: readonly Transaction[],
  baseCurrency: CurrencyCode,
  enrichments: readonly StoredTransactionFx[] = [],
):
  | { status: 'VALUED'; valuations: ExternalFlowBaseValuation[] }
  | PendingExternalFlowFx {
  const valuations: ExternalFlowBaseValuation[] = []
  const flows: PendingExternalFlow[] = []
  for (const transaction of transactions) {
    if (
      transaction.type !== 'CONTRIBUTION' &&
      transaction.type !== 'WITHDRAWAL'
    )
      continue
    const amount = resolveExternalFlowAmount(transaction)
    const nominal = parseDecimal(amount)
    const sameCurrency = transaction.currency === baseCurrency
    const enrichment = enrichments.find(
      (row) => row.transactionId === transaction.id,
    )
    const rate = sameCurrency ? '1' : (transaction.fxRate ?? enrichment?.fxRate)
    let reason: PendingExternalFlow['reason'] | null = null
    if (!sameCurrency) {
      if (
        baseCurrency !== 'ARS' ||
        !['USD_MEP', 'USD_CABLE'].includes(transaction.currency)
      )
        reason = 'UNSUPPORTED_FX'
      else if (!rate) reason = 'MISSING_FX'
      else if (
        transaction.fxRate === null &&
        enrichment &&
        (enrichment.fxDate !== transaction.date ||
          enrichment.fxKind !==
            (transaction.currency === 'USD_MEP' ? 'MEP' : 'CCL'))
      )
        reason = 'UNSUPPORTED_FX'
      else if (!(
        transaction.sourceDocumentId ||
        (transaction.fxRate === null && enrichment?.sourceDocumentId)
      ))
        reason = 'MISSING_PROVENANCE'
    }
    let amountBase: string | null = null
    if (!reason && rate) {
      try {
        const decimalRate = parseDecimal(rate)
        if (!decimalRate.isFinite() || decimalRate.lte(0)) reason = 'INVALID_FX'
        else
          amountBase = new ValuationDecimal(nominal.toString())
            .times(decimalRate.toString())
            .toFixed()
      } catch {
        reason = 'INVALID_FX'
      }
    }
    if (reason || amountBase === null || !rate) {
      flows.push({
        transactionId: transaction.id,
        date: transaction.date,
        type: transaction.type,
        amount,
        currency: transaction.currency,
        reference: transaction.sourceReference,
        sourceDocumentId: transaction.sourceDocumentId,
        reason: reason ?? 'MISSING_FX',
      })
      continue
    }
    valuations.push({
      transactionId: transaction.id,
      date: transaction.date,
      amount,
      currency: transaction.currency,
      amountBase,
      baseCurrency,
      fxRate: rate,
      fxKind: sameCurrency
        ? 'IDENTITY'
        : transaction.fxRate !== null
          ? 'TRANSACTION'
          : enrichment!.fxKind,
      provenance: {
        sourceDocumentId:
          sameCurrency || transaction.fxRate !== null
            ? transaction.sourceDocumentId
            : enrichment!.sourceDocumentId,
        reference: transaction.sourceReference,
        ...(transaction.fxRate === null && !sameCurrency && enrichment
          ? { enrichment }
          : {}),
      },
    })
  }
  return flows.length
    ? { status: 'PENDING_EXTERNAL_FLOW_FX', baseCurrency, flows }
    : { status: 'VALUED', valuations }
}
