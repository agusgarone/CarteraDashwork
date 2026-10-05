import type { DatabaseClient } from '../database/client'
import { persist, RepositoryError } from '../database/errors'
import { mapDocumentType, mapId } from '../database/mappers/values'
import type { EntityId } from '../domain/common'
import type { DocumentType } from '../domain/document'

export interface PositionFieldSource {
  positionId: EntityId
  fieldName: 'quantity' | 'unit_price' | 'market_value'
  documentType: DocumentType
  asOfDate: string
}

interface PositionFieldSourceRow {
  position_id: number
  field_name: string
  document_type: string
  as_of_date: string
}

const FIELD_NAMES = ['quantity', 'unit_price', 'market_value'] as const

export interface PositionSourceRepository {
  getBySnapshot(snapshotId: EntityId): Promise<PositionFieldSource[]>
}

export function createPositionSourceRepository(db: DatabaseClient): PositionSourceRepository {
  return {
    getBySnapshot(snapshotId) {
      return persist('positionSource.getBySnapshot', async () => {
        const rows = await db.select<PositionFieldSourceRow>(
          `SELECT f.position_id, f.field_name, d.type AS document_type, f.as_of_date
           FROM position_field_sources f
           JOIN positions p ON p.id = f.position_id
           JOIN documents d ON d.id = f.document_id
           WHERE p.snapshot_id = $1
           ORDER BY f.position_id ASC, f.field_name ASC`,
          [snapshotId],
        )
        return rows.map((row) => ({
          positionId: mapId(row.position_id),
          fieldName: mapFieldName(row.field_name),
          documentType: mapDocumentType(row.document_type),
          asOfDate: row.as_of_date,
        }))
      })
    },
  }
}

function mapFieldName(value: string): PositionFieldSource['fieldName'] {
  for (const field of FIELD_NAMES) {
    if (field === value) return field
  }
  throw new RepositoryError(`Campo de procedencia no reconocido: ${value}`)
}
