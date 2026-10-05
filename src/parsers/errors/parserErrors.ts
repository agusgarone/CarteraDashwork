/** El documento no se pudo interpretar. No es un fallo del motor de rendimiento. */
export class ParserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParserError'
  }
}

/** El PDF no trae texto. Esta versión no recurre a OCR. */
export class UnreadableDocumentError extends ParserError {
  constructor() {
    super('El PDF no contiene texto extraíble. Esta versión no usa OCR.')
    this.name = 'UnreadableDocumentError'
  }
}
