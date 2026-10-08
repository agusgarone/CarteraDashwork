import type { DatabaseClient } from '../database/client'
import type { EntityId } from '../domain/common'
import { extractPdfDocument } from '../parsers/text/extractPdfText'
import { parseBalanzMonthlyAccountDocument } from '../parsers/balanz/monthlyAccount'
import { createCashMovementLegRepository } from '../repositories/cashMovementLegRepository'
import { createDocumentRepository } from '../repositories/documentRepository'
import { createTransactionRepository } from '../repositories/transactionRepository'
import { cashMovementLegsFromAccount } from './cashMovementLegs'

const INTERNAL_MOVEMENT_TYPES = new Set([
  'BUY',
  'SELL',
  'FUND_SUBSCRIPTION',
  'FUND_REDEMPTION',
  'FX_CONVERSION',
])

/**
 * Si el período ya estaba importado, las patas de caja pueden faltar.
 * Se leen del resumen mensual guardado y no se pisan si ya existen.
 */
export async function ensureCashMovementLegs(options: {
  db: DatabaseClient
  periodId: EntityId
  readPdf: (relativePath: string) => Promise<Uint8Array | null>
}): Promise<void> {
  const transactions = await createTransactionRepository(options.db).getByPeriod(options.periodId)
  if (!transactions.some((movement) => INTERNAL_MOVEMENT_TYPES.has(movement.type))) return

  const legs = createCashMovementLegRepository(options.db)
  const stored = await legs.getByPeriod(options.periodId)
  const costsMissing = stored.some(
    (leg) =>
      leg.role === 'TRADE_SETTLEMENT' &&
      leg.commission == null &&
      leg.vat == null &&
      leg.marketFees == null &&
      leg.taxComponent == null,
  )
  if (stored.length > 0 && !costsMissing) return

  const documents = await createDocumentRepository(options.db).getByPeriod(options.periodId)
  const account = documents.find((document) => document.type === 'MONTHLY_ACCOUNT')
  if (!account) return

  const bytes = await options.readPdf(account.localPath)
  if (!bytes) return
  const parsedLegs = cashMovementLegsFromAccount(parseBalanzMonthlyAccountDocument(await extractPdfDocument(bytes)))
  if (stored.length === 0) {
    await legs.saveIfMissing(options.periodId, parsedLegs)
    return
  }
  await legs.fillMissingCosts(options.periodId, parsedLegs)
}
