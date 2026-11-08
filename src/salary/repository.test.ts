import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openFileDatabase, openMemoryDatabase } from '../database/sqliteMemory'
import { createSalaryRepository } from './repository'
import { emptyPlan, resolveMonth } from './model'
import { buildPortableBackup } from '../backup/portableBackup'
import { restoreBackupOnto } from '../backup/restoreFiles'
import { readFile } from 'node:fs/promises'
const temporary: string[] = []
afterEach(async () => {
  for (const root of temporary.splice(0))
    await rm(root, { recursive: true, force: true })
})
async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), 'salary-test-'))
  temporary.push(root)
  return root
}

describe('persistencia de sueldo en SQLite', () => {
  it('guarda el mes completo y conserva pagos e ingresos tras reabrir', async () => {
    const root = await folder()
    const file = path.join(root, 'cartera.db')
    const first = openFileDatabase(file)
    const plan = emptyPlan('2026-11')
    plan.incomes.push({
      id: 'salary',
      name: 'Sueldo',
      gross: '100000',
      currency: 'ARS',
      deductionPercent: '17',
    })
    const record = await createSalaryRepository(first.client).save(plan, null)
    first.close()
    const reopened = openFileDatabase(file)
    try {
      expect(await createSalaryRepository(reopened.client).list()).toEqual([
        record,
      ])
    } finally {
      reopened.close()
    }
  })
  it('dos guardados concurrentes tienen un ganador sin sobrescribir cambios', async () => {
    const db = openMemoryDatabase()
    try {
      const repo = createSalaryRepository(db.client)
      const plan = emptyPlan('2026-11')
      await repo.save(plan, null)
      const results = await Promise.allSettled([
        repo.save({ ...plan, livingAllowance: '100' }, 1),
        repo.save({ ...plan, livingAllowance: '200' }, 1),
      ])
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1)
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1)
      expect((await repo.list())[0]!.revision).toBe(2)
      await expect(repo.save(plan, null)).rejects.toThrow('otra sesión')
    } finally {
      db.close()
    }
  })
  it('editar diciembre conserva el presupuesto de noviembre', async () => {
    const db = openMemoryDatabase()
    try {
      const repo = createSalaryRepository(db.client)
      await repo.save(emptyPlan('2026-11'), null)
      const december = resolveMonth(await repo.list(), '2026-12')
      december.plan.livingAllowance = '50'
      await repo.save(december.plan, null)
      expect((await repo.list())[0]!.plan.livingAllowance).toBe('0')
    } finally {
      db.close()
    }
  })
  it('el backup portable incluye los presupuestos y los restaura', async () => {
    const root = await folder()
    const db = openFileDatabase(path.join(root, 'source.db'))
    const repo = createSalaryRepository(db.client)
    const plan = emptyPlan('2026-11')
    plan.livingAllowance = '123.45'
    const saved = await repo.save(plan, null)
    const snapshot = path.join(root, 'snapshot.db')
    db.snapshot(snapshot)
    db.close()
    const zipBytes = buildPortableBackup({
      appVersion: '0.1.0',
      createdAt: new Date().toISOString(),
      databaseBytes: new Uint8Array(await readFile(snapshot)),
      documents: [],
    })
    const target = path.join(root, 'restored.db')
    await restoreBackupOnto({
      zipBytes,
      databasePath: target,
      documentsDir: path.join(root, 'documents'),
      safetyZipReady: false,
    })
    const restored = openFileDatabase(target)
    try {
      expect(await createSalaryRepository(restored.client).list()).toEqual([
        saved,
      ])
    } finally {
      restored.close()
    }
  })
  it('restaura un backup anterior y aplica la migración de sueldo al abrirlo', async () => {
    const root = await folder()
    const source = path.join(root, 'old.db')
    openFileDatabase(source).close()
    const raw = new DatabaseSync(source)
    raw.exec(
      "DROP TABLE salary_months; DELETE FROM schema_migrations WHERE version = '006'",
    )
    raw.close()
    const zipBytes = buildPortableBackup({
      appVersion: '0.1.0',
      createdAt: new Date().toISOString(),
      databaseBytes: new Uint8Array(await readFile(source)),
      documents: [],
    })
    const target = path.join(root, 'restored.db')
    await restoreBackupOnto({
      zipBytes,
      databasePath: target,
      documentsDir: path.join(root, 'documents'),
      safetyZipReady: false,
    })
    const restored = openFileDatabase(target)
    try {
      await expect(
        createSalaryRepository(restored.client).save(
          emptyPlan('2026-11'),
          null,
        ),
      ).resolves.toMatchObject({ revision: 1 })
    } finally {
      restored.close()
    }
  })
  it('rechaza presupuestos corruptos sin reemplazarlos por ceros', async () => {
    const db = openMemoryDatabase()
    try {
      await db.client.execute(
        'INSERT INTO salary_months (month, document, revision) VALUES ($1,$2,1)',
        ['2026-11', '{"version":99}'],
      )
      await expect(createSalaryRepository(db.client).list()).rejects.toThrow(
        'versión',
      )
    } finally {
      db.close()
    }
  })
})
