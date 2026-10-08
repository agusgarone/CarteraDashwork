export class ImportPeriodValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportPeriodValidationError'
  }
}

export class ImportConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportConflictError'
  }
}

/** Un movimiento reconocido no se pudo armar. El período no se confirma. */
export class ImportPeriodParsingError extends Error {
  readonly unreadMovements: number

  constructor(unreadMovements: number) {
    const noun = unreadMovements === 1 ? 'movimiento no pudo leerse' : 'movimientos no pudieron leerse'
    super(`${unreadMovements} ${noun} correctamente.`)
    this.name = 'ImportPeriodParsingError'
    this.unreadMovements = unreadMovements
  }
}
