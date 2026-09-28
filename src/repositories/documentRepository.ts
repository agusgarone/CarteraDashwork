import type { DatabaseClient } from '../database/client'
import { insertedId } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { RepositoryError, persist } from '../database/errors'
import { mapDocumentRow } from '../database/mappers/documentMapper'
import type { DocumentRow } from '../database/rows/documentRow'
import type { EntityId } from '../domain/common'
import type {
  DocumentProcessingStatus,
  DocumentType,
  PortfolioDocument,
} from '../domain/document'

export interface CreatePortfolioDocumentInput {
  periodId: EntityId
  type: DocumentType
  originalFilename: string
  localPath: string
  sha256: string
  processingStatus?: DocumentProcessingStatus
  parserVersion?: string | null
}

const COLUMNS =
  'id, period_id, type, original_filename, local_path, sha256, processing_status, parser_version, created_at'

export interface DocumentRepository {
  getById(id: EntityId): Promise<PortfolioDocument | null>
  getByPeriod(periodId: EntityId): Promise<PortfolioDocument[]>
  getByHash(sha256: string): Promise<PortfolioDocument | null>
  create(input: CreatePortfolioDocumentInput): Promise<PortfolioDocument>
  updateProcessingStatus(
    id: EntityId,
    status: DocumentProcessingStatus,
  ): Promise<PortfolioDocument>
}

/**
 * La ruta se guarda relativa al directorio de datos de la aplicación.
 * Esta capa no copia archivos.
 */
function assertRelativeLocalPath(localPath: string): void {
  if (localPath.trim().length === 0) {
    throw new RepositoryError('document.create: localPath no puede estar vacío')
  }

  const absolute =
    /^[a-zA-Z]:[\\/]/.test(localPath) ||
    localPath.startsWith('/') ||
    localPath.startsWith('\\')

  if (absolute || localPath.split(/[\\/]/).includes('..')) {
    throw new RepositoryError(
      'document.create: localPath debe ser relativo al directorio de datos, por ejemplo documents/2026/08/resumen-comitente.pdf',
    )
  }
}

export function createDocumentRepository(db: DatabaseClient): DocumentRepository {
  async function findById(id: EntityId): Promise<PortfolioDocument | null> {
    const row = await db.selectOne<DocumentRow>(
      `SELECT ${COLUMNS} FROM documents WHERE id = $1`,
      [id],
    )
    return row ? mapDocumentRow(row) : null
  }

  return {
    getById(id) {
      return persist('document.getById', () => findById(id))
    },

    getByPeriod(periodId) {
      return persist('document.getByPeriod', async () => {
        const rows = await db.select<DocumentRow>(
          `SELECT ${COLUMNS} FROM documents WHERE period_id = $1 ORDER BY id ASC`,
          [periodId],
        )
        return rows.map(mapDocumentRow)
      })
    },

    getByHash(sha256) {
      return persist('document.getByHash', async () => {
        const row = await db.selectOne<DocumentRow>(
          `SELECT ${COLUMNS} FROM documents WHERE sha256 = $1`,
          [sha256],
        )
        return row ? mapDocumentRow(row) : null
      })
    },

    create(input) {
      return persist('document.create', async () => {
        assertRelativeLocalPath(input.localPath)
        const result = await db.execute(
          `INSERT INTO documents (
             period_id, type, original_filename, local_path, sha256, processing_status, parser_version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.periodId,
            input.type,
            input.originalFilename,
            input.localPath,
            input.sha256,
            input.processingStatus ?? 'PENDING',
            input.parserVersion ?? null,
          ],
        )
        const id = insertedId(result, 'document.create')
        const created = await findById(id)
        if (!created) {
          throw new RepositoryError('document.create: no se pudo leer el registro creado')
        }
        return created
      })
    },

    updateProcessingStatus(id, status) {
      return persist('document.updateProcessingStatus', async () => {
        const result = await db.execute(
          `UPDATE documents SET processing_status = $1 WHERE id = $2`,
          [status, id],
        )
        if (result.rowsAffected === 0) {
          throw new RepositoryError(`document.updateProcessingStatus: el documento ${id} no existe`)
        }
        const updated = await findById(id)
        if (!updated) {
          throw new RepositoryError(`document.updateProcessingStatus: el documento ${id} no existe`)
        }
        return updated
      })
    },
  }
}

export const documentRepository = createDocumentRepository(getAppDatabaseClient())
