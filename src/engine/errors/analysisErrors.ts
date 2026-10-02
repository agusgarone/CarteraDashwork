import type { EntityId } from '../../domain/common'

/** Error de análisis. No es un fallo de base de datos. */
export class AnalysisError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AnalysisError'
  }
}

/** No hay un snapshot anterior al inicio del período. No se inventa apertura en cero. */
export class MissingOpeningSnapshotError extends AnalysisError {
  constructor(periodId: EntityId) {
    super(
      `No hay snapshot anterior al inicio del período ${periodId}. No se puede calcular el resultado.`,
    )
    this.name = 'MissingOpeningSnapshotError'
  }
}

/** El período no tiene snapshot de cierre. No se calcula un resultado parcial. */
export class MissingClosingSnapshotError extends AnalysisError {
  constructor(periodId: EntityId) {
    super(`El período ${periodId} no tiene snapshot de cierre.`)
    this.name = 'MissingClosingSnapshotError'
  }
}

export class MissingPeriodError extends AnalysisError {
  constructor(periodId: EntityId) {
    super(`El período ${periodId} no existe.`)
    this.name = 'MissingPeriodError'
  }
}

/** El movimiento no tiene netAmount ni grossAmount. No se reemplaza por cero. */
export class MissingTransactionAmountError extends AnalysisError {
  constructor(transactionId: EntityId, movementType: string) {
    super(
      `El movimiento ${transactionId} (${movementType}) no tiene netAmount ni grossAmount.`,
    )
    this.name = 'MissingTransactionAmountError'
  }
}
