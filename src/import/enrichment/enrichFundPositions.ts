import type { DecimalString } from '../../domain/common'
import type { CurrencyCode } from '../../domain/currency'
import type { DocumentType } from '../../domain/document'
import { formatExact, parseDecimal } from '../../engine/money'
import type { ParsedConsolidatedPosition, ParsedPosition } from '../../parsers/models/parsedConsolidatedPosition'
import type {
  ParsedFundStatement,
  ParsedFundStatementRow,
  ParsedMonthlyFundStatement,
} from '../../parsers/models/parsedMonthlyFundStatement'
import {
  fundClassKeyFromConsolidatedName,
  fundClassKeyFromStatement,
  fundMatchKeyFromConsolidatedName,
} from '../fundIdentity'

/**
 * Origen lógico de un campo. Más adelante el import puede reemplazar
 * documentType por el id persistido del documento.
 */
export interface FieldSource {
  documentType: Extract<DocumentType, 'CONSOLIDATED_POSITION' | 'MONTHLY_FUND_STATEMENT'>
  sourceReference: string | null
  asOfDate: string
}

export interface PositionEnrichmentAudit {
  positionIdentity: string
  quantitySource: FieldSource
  unitPriceSource: FieldSource
  marketValueSource: FieldSource
}

export type FundEnrichmentWarningCode =
  | 'NO_MATCH'
  | 'DUPLICATE_MATCH'
  | 'MISSING_DATE'
  | 'MISSING_AMOUNT'
  | 'CURRENCY_MISMATCH'

export interface FundEnrichmentWarning {
  code: FundEnrichmentWarningCode
  message: string
  positionIdentity: string | null
}

/** Diagnóstico posterior al enrichment. No reemplaza la reconciliación del PDF de posición. */
export interface EnrichedDetailReconciliation {
  positionsTotal: DecimalString
  cashCalculatedTotal: DecimalString
  calculatedTotal: DecimalString
  reportedTotal: DecimalString
  difference: DecimalString
}

export interface FundEnrichmentResult {
  position: ParsedConsolidatedPosition
  audits: PositionEnrichmentAudit[]
  warnings: FundEnrichmentWarning[]
  enrichedDetail: EnrichedDetailReconciliation
}

export interface FundEnrichmentInput {
  consolidatedPosition: ParsedConsolidatedPosition
  fundStatement: ParsedMonthlyFundStatement
  snapshotDate: string
  /** Moneda de los valores de la posición consolidada. En Balanz son pesos. */
  holdingCurrency: CurrencyCode
}

const POSITION_STATE = new Set<ParsedFundStatementRow['type']>(['PREVIOUS_BALANCE', 'CURRENT_INVESTMENT'])

/**
 * Reemplaza cantidad, precio y valor de los fondos que coinciden en categoría,
 * clase y moneda. El total reportado, la caja y el resto de las tenencias quedan.
 * Saldo anterior y total de inversión no se convierten en movimientos.
 */
export function enrichFundPositions(input: FundEnrichmentInput): FundEnrichmentResult {
  const warnings: FundEnrichmentWarning[] = []
  const statementByClass = groupFunds(input.fundStatement.funds)
  const consolidatedClassCounts = countConsolidatedClasses(input.consolidatedPosition.positions)
  const audits: PositionEnrichmentAudit[] = []
  const positions = input.consolidatedPosition.positions.map((position) => {
    if (position.normalizedCategory !== 'FUND') {
      audits.push(audit(position.ticker, consolidatedSource(position, input.snapshotDate)))
      return position
    }

    const identity = fundMatchKeyFromConsolidatedName(position.name, input.holdingCurrency)
    const classKey = fundClassKeyFromConsolidatedName(position.name)
    const consolidatedSourceFields = consolidatedSource(position, input.snapshotDate)
    if (!identity || !classKey) {
      warnings.push(warn('NO_MATCH', 'La tenencia no tiene categoría y clase para cruzar con el fondo.', position.ticker))
      audits.push(audit(position.ticker, consolidatedSourceFields))
      return position
    }
    if ((consolidatedClassCounts.get(classKey) ?? 0) > 1) {
      warnings.push(warn('DUPLICATE_MATCH', 'Hay más de una tenencia con la misma categoría y clase.', identity))
      audits.push(audit(identity, consolidatedSourceFields))
      return position
    }

    const candidates = statementByClass.get(classKey) ?? []
    if (candidates.length === 0) {
      warnings.push(warn('NO_MATCH', 'El resumen de fondos no tiene esa categoría y clase.', identity))
      audits.push(audit(identity, consolidatedSourceFields))
      return position
    }

    const sameCurrency = candidates.filter((fund) => fund.currency === input.holdingCurrency)
    if (sameCurrency.length === 0) {
      warnings.push(warn('CURRENCY_MISMATCH', 'El fondo está en otra moneda.', identity))
      audits.push(audit(identity, consolidatedSourceFields))
      return position
    }
    if (sameCurrency.length > 1) {
      warnings.push(warn('DUPLICATE_MATCH', 'Hay más de un fondo con la misma categoría, clase y moneda.', identity))
      audits.push(audit(identity, consolidatedSourceFields))
      return position
    }

    const fund = sameCurrency[0]
    if (!fund) {
      warnings.push(warn('NO_MATCH', 'El resumen de fondos no tiene esa categoría y clase.', identity))
      audits.push(audit(identity, consolidatedSourceFields))
      return position
    }
    const rows = fund.rows.filter((row) => row.date === input.snapshotDate && POSITION_STATE.has(row.type))
    if (rows.length === 0) {
      warnings.push(warn('MISSING_DATE', 'El fondo no tiene un estado en la fecha del snapshot.', identity))
      audits.push(audit(identity, consolidatedSourceFields))
      return position
    }
    if (rows.length > 1) {
      warnings.push(warn('DUPLICATE_MATCH', 'El fondo tiene más de un estado en la fecha del snapshot.', identity))
      audits.push(audit(identity, consolidatedSourceFields))
      return position
    }

    const row = rows[0]
    if (!row || row.amount === null || row.quantity === null || row.unitValue === null) {
      warnings.push(warn('MISSING_AMOUNT', 'El estado del fondo no trae cantidad, valor de cuotaparte y monto.', identity))
      audits.push(audit(identity, consolidatedSourceFields))
      return position
    }

    const source = fundSource(row)
    audits.push(audit(identity, source))
    return {
      ...position,
      quantity: row.quantity,
      unitPrice: row.unitValue,
      marketValue: row.amount,
    }
  })

  const position: ParsedConsolidatedPosition = {
    ...input.consolidatedPosition,
    positions,
  }

  return {
    position,
    audits,
    warnings,
    enrichedDetail: enrichedDetail(position),
  }
}

function groupFunds(funds: readonly ParsedFundStatement[]): Map<string, ParsedFundStatement[]> {
  const grouped = new Map<string, ParsedFundStatement[]>()
  for (const fund of funds) {
    const key = fundClassKeyFromStatement(fund)
    if (!key) continue
    const current = grouped.get(key) ?? []
    current.push(fund)
    grouped.set(key, current)
  }
  return grouped
}

function countConsolidatedClasses(positions: readonly ParsedPosition[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const position of positions) {
    if (position.normalizedCategory !== 'FUND') continue
    const key = fundClassKeyFromConsolidatedName(position.name)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function consolidatedSource(position: ParsedPosition, snapshotDate: string): FieldSource {
  return {
    documentType: 'CONSOLIDATED_POSITION',
    sourceReference: position.sourceReference,
    asOfDate: snapshotDate,
  }
}

function fundSource(row: ParsedFundStatementRow): FieldSource {
  return {
    documentType: 'MONTHLY_FUND_STATEMENT',
    sourceReference: row.sourceReference,
    asOfDate: row.date,
  }
}

function audit(positionIdentity: string, source: FieldSource): PositionEnrichmentAudit {
  return {
    positionIdentity,
    quantitySource: source,
    unitPriceSource: source,
    marketValueSource: source,
  }
}

function warn(
  code: FundEnrichmentWarningCode,
  message: string,
  positionIdentity: string | null,
): FundEnrichmentWarning {
  return { code, message, positionIdentity }
}

function enrichedDetail(position: ParsedConsolidatedPosition): EnrichedDetailReconciliation {
  let positionsTotal = parseDecimal('0')
  for (const holding of position.positions) {
    positionsTotal = positionsTotal.plus(holding.marketValue)
  }
  const cashCalculatedTotal = parseDecimal(position.reconciliation.cashCalculatedTotal)
  const calculatedTotal = positionsTotal.plus(cashCalculatedTotal)
  const reportedTotal = parseDecimal(position.reportedTotal)
  return {
    positionsTotal: formatExact(positionsTotal),
    cashCalculatedTotal: formatExact(cashCalculatedTotal),
    calculatedTotal: formatExact(calculatedTotal),
    reportedTotal: formatExact(reportedTotal),
    difference: formatExact(calculatedTotal.minus(reportedTotal)),
  }
}
