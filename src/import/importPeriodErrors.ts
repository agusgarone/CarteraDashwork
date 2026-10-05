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
