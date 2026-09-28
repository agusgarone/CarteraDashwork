import type { PortfolioDocument } from '../../domain/document'
import type { DocumentRow } from '../rows/documentRow'
import {
  mapDocumentProcessingStatus,
  mapDocumentType,
  mapId,
  mapNullableText,
} from './values'

export function mapDocumentRow(row: DocumentRow): PortfolioDocument {
  return {
    id: mapId(row.id),
    periodId: mapId(row.period_id),
    type: mapDocumentType(row.type),
    originalFilename: row.original_filename,
    localPath: row.local_path,
    sha256: row.sha256,
    processingStatus: mapDocumentProcessingStatus(row.processing_status),
    parserVersion: mapNullableText(row.parser_version),
    createdAt: row.created_at,
  }
}
