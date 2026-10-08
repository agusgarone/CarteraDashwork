import type { CashLegRole, CashMovementLeg } from '../engine/calculations/cashLedger'
import type { ParsedMonthlyAccount, ParsedOperationGroup } from '../parsers/models/parsedMonthlyAccount'

/**
 * La pata de caja del resumen es el monto que entra o sale.
 * La fila del instrumento no se vuelve a calcular como cantidad por precio.
 * Una transferencia a custodia no mueve caja.
 */
export function cashMovementLegsFromAccount(account: ParsedMonthlyAccount): CashMovementLeg[] {
  return account.operationGroups.flatMap((group, index) => legsOf(group, index))
}

function legsOf(group: ParsedOperationGroup, index: number): CashMovementLeg[] {
  if (group.operationType === 'KNOWN_NON_ECONOMIC' || group.operationType === 'STOCK_DIVIDEND') return []
  const operationType = group.operationType
  const operationId = group.operationReference ?? `row:${index}`
  return group.legs.flatMap((leg) => {
    if (leg.section !== 'CASH' || leg.currency === null || leg.net === null) return []
    const date = leg.date ?? group.date
    if (!date) return []
    return [
      {
        operationId,
        operationType,
        currency: leg.currency,
        amount: leg.net,
        date,
        role: roleOf(operationType),
        commission: leg.commission,
        vat: leg.vat,
        marketFees: leg.marketFees,
        taxComponent: leg.taxComponent,
      },
    ]
  })
}

function roleOf(operationType: Exclude<ParsedOperationGroup['operationType'], 'KNOWN_NON_ECONOMIC' | 'STOCK_DIVIDEND'>): CashLegRole {
  if (operationType === 'CONTRIBUTION' || operationType === 'WITHDRAWAL') return 'EXTERNAL_FLOW'
  if (operationType === 'BUY' || operationType === 'SELL') return 'TRADE_SETTLEMENT'
  if (operationType === 'FUND_SUBSCRIPTION' || operationType === 'FUND_REDEMPTION') return 'FUND_SETTLEMENT'
  if (operationType === 'FX_CONVERSION') return 'FX_CONVERSION'
  if (operationType === 'DIVIDEND') return 'DIVIDEND'
  if (operationType === 'INTEREST') return 'INTEREST'
  if (operationType === 'FEE') return 'FEE'
  if (operationType === 'TAX') return 'TAX'
  return 'OTHER'
}
