import type { DatabaseClient } from '../database/client'
import { insertedId } from '../database/client'
import { getAppDatabaseClient } from '../database/database'
import { RepositoryError, persist } from '../database/errors'
import { mapInstrumentRow } from '../database/mappers/instrumentMapper'
import type { InstrumentRow } from '../database/rows/instrumentRow'
import type { EntityId } from '../domain/common'
import type { Instrument, InstrumentCategory } from '../domain/instrument'

export type CreateInstrumentInput = Omit<Instrument, 'id' | 'createdAt'>

const COLUMNS = 'id, ticker, name, category, currency, broker_identifier, created_at'

export interface InstrumentRepository {
  getById(id: EntityId): Promise<Instrument | null>
  getAll(): Promise<Instrument[]>
  getByTicker(ticker: string): Promise<Instrument[]>
  findByTickerAndCategory(
    ticker: string,
    category: InstrumentCategory,
  ): Promise<Instrument | null>
  create(input: CreateInstrumentInput): Promise<Instrument>
}

export function createInstrumentRepository(db: DatabaseClient): InstrumentRepository {
  async function findById(id: EntityId): Promise<Instrument | null> {
    const row = await db.selectOne<InstrumentRow>(
      `SELECT ${COLUMNS} FROM instruments WHERE id = $1`,
      [id],
    )
    return row ? mapInstrumentRow(row) : null
  }

  return {
    getById(id) {
      return persist('instrument.getById', () => findById(id))
    },

    getAll() {
      return persist('instrument.getAll', async () => {
        const rows = await db.select<InstrumentRow>(
          `SELECT ${COLUMNS} FROM instruments ORDER BY ticker ASC, id ASC`,
        )
        return rows.map(mapInstrumentRow)
      })
    },

    getByTicker(ticker) {
      return persist('instrument.getByTicker', async () => {
        const rows = await db.select<InstrumentRow>(
          `SELECT ${COLUMNS}
           FROM instruments
           WHERE ticker = $1
           ORDER BY category ASC, id ASC`,
          [ticker],
        )
        return rows.map(mapInstrumentRow)
      })
    },

    findByTickerAndCategory(ticker, category) {
      return persist('instrument.findByTickerAndCategory', async () => {
        const row = await db.selectOne<InstrumentRow>(
          `SELECT ${COLUMNS}
           FROM instruments
           WHERE ticker = $1 AND category = $2`,
          [ticker, category],
        )
        return row ? mapInstrumentRow(row) : null
      })
    },

    create(input) {
      return persist('instrument.create', async () => {
        const result = await db.execute(
          `INSERT INTO instruments (ticker, name, category, currency, broker_identifier)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            input.ticker,
            input.name,
            input.category,
            input.currency,
            input.brokerIdentifier,
          ],
        )
        const id = insertedId(result, 'instrument.create')
        const created = await findById(id)
        if (!created) {
          throw new RepositoryError('instrument.create: no se pudo leer el registro creado')
        }
        return created
      })
    },
  }
}

export const instrumentRepository = createInstrumentRepository(getAppDatabaseClient())
