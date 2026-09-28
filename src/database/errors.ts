export class RepositoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RepositoryError'
  }
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message
    if (typeof message === 'string') return message
  }
  return String(error)
}

export function toRepositoryError(error: unknown, context: string): RepositoryError {
  const message = readErrorMessage(error)

  if (message.includes('UNIQUE constraint failed')) {
    return new RepositoryError(`${context}: ya existe un registro con esa clave única`, {
      cause: error,
    })
  }

  if (message.includes('FOREIGN KEY constraint failed')) {
    return new RepositoryError(`${context}: la referencia no existe en la base`, {
      cause: error,
    })
  }

  if (message.includes('CHECK constraint failed')) {
    return new RepositoryError(
      `${context}: un valor no cumple una restricción de la base`,
      { cause: error },
    )
  }

  return new RepositoryError(`${context}: ${message}`, { cause: error })
}

export async function persist<T>(context: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof RepositoryError) throw error
    throw toRepositoryError(error, context)
  }
}
