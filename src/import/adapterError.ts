/** El documento parseado no entra en el modelo de dominio. No es un cálculo del motor. */
export class AdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdapterError'
  }
}
