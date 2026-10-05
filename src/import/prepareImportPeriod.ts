/// <reference types="node" />

import path from 'node:path'
import type { DocumentType } from '../domain/document'
import { parseBalanzConsolidatedPositionDocument, parseBalanzConsolidatedPositionText } from '../parsers/balanz/consolidatedPosition'
import { parseBalanzMonthlyAccountDocument, parseBalanzMonthlyAccountText } from '../parsers/balanz/monthlyAccount'
import {
  parseBalanzMonthlyFundStatementDocument,
  parseBalanzMonthlyFundStatementText,
} from '../parsers/balanz/monthlyFundStatement'
import type { ParsedConsolidatedPosition } from '../parsers/models/parsedConsolidatedPosition'
import type { ParsedMonthlyAccount } from '../parsers/models/parsedMonthlyAccount'
import type { ParsedMonthlyFundStatement } from '../parsers/models/parsedMonthlyFundStatement'
import { extractPdfDocument, type PdfTextDocument } from '../parsers/text/extractPdfText'
import { detectBalanzDocument, type ImportableDocumentType } from './detectDocument'
import { documentRelativePath, stageUserFile } from './documentStore'
import { enrichFundPositions, type FundEnrichmentResult } from './enrichment/enrichFundPositions'
import { ImportPeriodValidationError } from './importPeriodErrors'

export interface ImportFile {
  originalPath: string
  originalFileName: string
  /** Pista opcional. Si no coincide con el contenido, el import se rechaza. */
  documentType?: DocumentType
}

export interface PreparedFile {
  key: string
  periodKey: 'opening' | 'closing'
  kind: ImportableDocumentType
  originalFileName: string
  stagedPath: string
  sha256: string
  relativePath: string
  existingDocumentId: string | null
}

export interface ClassifiedPosition {
  file: PreparedFile
  position: ParsedConsolidatedPosition
  enriched: FundEnrichmentResult
}

export interface PreparedImport {
  files: PreparedFile[]
  opening: ClassifiedPosition | null
  closing: ClassifiedPosition
  account: { file: PreparedFile; parsed: ParsedMonthlyAccount }
  fund: { file: PreparedFile; parsed: ParsedMonthlyFundStatement }
  openingPeriod: { year: number; month: number } | null
  closingPeriod: { year: number; month: number }
}

const SLUG: Record<ImportableDocumentType, string> = {
  CONSOLIDATED_POSITION: 'consolidated-position',
  MONTHLY_ACCOUNT: 'monthly-account',
  MONTHLY_FUND_STATEMENT: 'monthly-fund-statement',
}

/**
 * Copia cada archivo a staging, detecta el tipo por el contenido y arma el período.
 * Todavía no escribe SQLite. El nombre del archivo no decide el tipo ni la fecha.
 */
export async function prepareImportPeriod(files: ImportFile[], stagingDir: string): Promise<PreparedImport> {
  const inputs: ParsedInput[] = []
  for (const file of files) {
    const staged = await stageUserFile(file.originalPath, stagingDir)
    const pdf = isPdf(staged.bytes) ? await extractPdfDocument(staged.bytes) : null
    const text = pdf ? pdf.text : new TextDecoder('utf8').decode(staged.bytes)
    const detected = detectBalanzDocument(text)
    if (!detected) {
      throw new ImportPeriodValidationError(`No se reconoce el documento ${file.originalFileName}.`)
    }
    if (file.documentType && file.documentType !== detected) {
      throw new ImportPeriodValidationError(`${file.originalFileName} no coincide con el tipo indicado.`)
    }
    inputs.push({
      originalFileName: path.basename(file.originalFileName),
      stagedPath: staged.stagedPath,
      sha256: staged.sha256,
      extension: extensionOf(file.originalFileName),
      kind: detected,
      text,
      pdf,
    })
  }
  return classify(inputs)
}

interface ParsedInput {
  originalFileName: string
  stagedPath: string
  sha256: string
  extension: string
  kind: ImportableDocumentType
  text: string
  pdf: PdfTextDocument | null
}

function classify(inputs: ParsedInput[]): PreparedImport {
  const accounts = inputs.filter((input) => input.kind === 'MONTHLY_ACCOUNT')
  const funds = inputs.filter((input) => input.kind === 'MONTHLY_FUND_STATEMENT')
  const positions = inputs.filter((input) => input.kind === 'CONSOLIDATED_POSITION')
  if (accounts.length !== 1 || funds.length !== 1 || (positions.length !== 1 && positions.length !== 2)) {
    throw new ImportPeriodValidationError(
      'El período necesita el resumen mensual, el resumen de fondos y la posición de cierre.',
    )
  }
  const accountInput = accounts[0]
  const fundInput = funds[0]
  if (!accountInput || !fundInput) {
    throw new ImportPeriodValidationError('Faltan documentos del período.')
  }

  const account = parseAccount(accountInput)
  const fund = parseFund(fundInput)
  const consolidated = positions.map((input) => ({ input, position: parsePosition(input) }))
  const closing = consolidated.find((item) => item.position.snapshotDate === account.period.endDate)
  const opening = consolidated.find((item) => item.position.snapshotDate < account.period.startDate)
  if (!closing || consolidated.length !== (opening ? 2 : 1)) {
    throw new ImportPeriodValidationError('Las posiciones no cierran el período del resumen mensual.')
  }
  if (fund.reportDate !== closing.position.snapshotDate) {
    throw new ImportPeriodValidationError('El resumen de fondos no corresponde a la fecha de cierre.')
  }

  const closingFile = prepared('closing-position', 'closing', closing.input, closing.position.snapshotDate)
  const accountFile = prepared('monthly-account', 'closing', accountInput, account.period.endDate)
  const fundFile = prepared('fund-statement', 'closing', fundInput, fund.reportDate)
  const openingFile = opening
    ? prepared('opening-position', 'opening', opening.input, opening.position.snapshotDate)
    : null
  const classifiedOpening = opening && openingFile
    ? {
        file: openingFile,
        position: opening.position,
        enriched: enrichFundPositions({
          consolidatedPosition: opening.position,
          fundStatement: fund,
          snapshotDate: opening.position.snapshotDate,
          holdingCurrency: 'ARS',
        }),
      }
    : null

  return {
    files: [openingFile, closingFile, accountFile, fundFile].filter((file): file is PreparedFile => file !== null),
    opening: classifiedOpening,
    closing: {
      file: closingFile,
      position: closing.position,
      enriched: enrichFundPositions({
        consolidatedPosition: closing.position,
        fundStatement: fund,
        snapshotDate: closing.position.snapshotDate,
        holdingCurrency: 'ARS',
      }),
    },
    account: { file: accountFile, parsed: account },
    fund: { file: fundFile, parsed: fund },
    openingPeriod: opening ? yearMonth(opening.position.snapshotDate) : null,
    closingPeriod: yearMonth(account.period.endDate),
  }
}

function prepared(
  key: string,
  periodKey: 'opening' | 'closing',
  input: ParsedInput,
  folderDate: string,
): PreparedFile {
  return {
    key,
    periodKey,
    kind: input.kind,
    originalFileName: input.originalFileName,
    stagedPath: input.stagedPath,
    sha256: input.sha256,
    relativePath: documentRelativePath(folderDate, input.sha256, SLUG[input.kind], input.extension),
    existingDocumentId: null,
  }
}

function parsePosition(input: ParsedInput): ParsedConsolidatedPosition {
  return input.pdf
    ? parseBalanzConsolidatedPositionDocument(input.pdf)
    : parseBalanzConsolidatedPositionText(input.text)
}

function parseAccount(input: ParsedInput): ParsedMonthlyAccount {
  return input.pdf ? parseBalanzMonthlyAccountDocument(input.pdf) : parseBalanzMonthlyAccountText(input.text)
}

function parseFund(input: ParsedInput): ParsedMonthlyFundStatement {
  return input.pdf
    ? parseBalanzMonthlyFundStatementDocument(input.pdf)
    : parseBalanzMonthlyFundStatementText(input.text)
}

function yearMonth(isoDate: string): { year: number; month: number } {
  const [year, month] = isoDate.split('-')
  return { year: Number(year), month: Number(month) }
}

function extensionOf(filename: string): string {
  const extension = path.extname(filename).toLowerCase()
  if (extension === '.pdf' || extension === '.txt') return extension
  return '.bin'
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}
