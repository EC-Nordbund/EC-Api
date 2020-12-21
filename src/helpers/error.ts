import { Response } from 'express'

/**
 * Fehler mit HTTP-Status Code
 * @author Sebastian
 */
export class ecError extends Error {
  /**
   * Erzeugt einen neuen Fehler mit Nachricht + Status code
   * @param message Fehlermeldung
   * @param code HTTP-Status-Code
   */
  constructor(message: string, public code = 500) {
    super(message)
    this.name = 'EC-Fehler'
  }
}

/**
 * Writes a error to Response Object
 *
 * @author Sebastian
 *
 * @param err Fehler
 * @param res Express Response Object
 */
export function errorHandler(err: unknown, res: Response): void {
  // Set Content-Type
  res.contentType('text/plain')

  if (err instanceof ecError) {
    // Handle EC-Error
    res.status(err.code).end(err.message)
  } else if (err instanceof Error) {
    // Handle Standard Error
    res.status(500).end(err.message)
  } else if (typeof err === 'string') {
    // Handle string
    res.status(500).end(err)
  } else {
    // Else
    res.status(500)
    res.end(
      `Ein unerwarteter (komischer) Fehler ist aufgetreten. (Bitte melde ihn.)\nFehler: ${String(
        err
      )}`
    )
  }
}
